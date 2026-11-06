"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Badge } from "@/components/ui/Badge";
import { Biirbou, type BiirbouMood } from "@/components/ui/Biirbou";
import { useOnline } from "@/client/hooks/useOnline";
import { ItemWarnings } from "@/components/ItemWarnings";
import { itemWarnings, type ItemWarning } from "@/lib/tripChecks";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FormError } from "@/components/ui/FormError";
import { Icon } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import { ReasoningText } from "@/components/ui/ReasoningText";
import { Textarea } from "@/components/ui/Textarea";
import { countryName } from "@/lib/country";
import { apiFetch, getSessionSnapshot, parseSessionUser } from "@/client/session";
import type { TripPassFeature } from "@/components/TripPassCard";
import {
  CATEGORY_ICONS,
  budgetTotal,
  localDay,
  parseDay,
  plannerError,
  tripDays,
  tripMoment,
  type PlannerError,
  type TripDetail,
  type TripItem,
} from "@/components/TripPlanner";
import { currencyDecimals } from "@/schemas/trip-expense.schema";
import { FilterBar, FilterChip } from "@/components/ui/FilterChip";
import { ENERGY_ICONS, WhatNowDialog } from "@/components/TripWhatNow";
import { TripChangePreview } from "@/components/TripChangePreview";
import {
  TRIP_DISRUPTIONS,
  TRIP_ENERGY_LEVELS,
  TRIP_MEMORY_MAX,
  TRIP_MESSAGE_MAX,
  type TripDisruption,
  type TripEnergyLevel,
  type TripMessageContext,
} from "@/schemas/trip.schema";

type TripSuggestion = Omit<TripItem, "id" | "color" | "origin" | "version"> & {
  id: number;
  status: "pending" | "accepted" | "rejected";
  action: "add" | "update" | "delete";
  // Activité modifiée ou supprimée, telle qu'elle est maintenant (null : ajout, ou activité déjà supprimée).
  target: { id: number; day: string; start_time: string; title: string } | null;
};

type TripMessage = {
  id: number;
  role: "user" | "assistant";
  content: string;
  off_topic: boolean;
  author: { id: string; display_name: string } | null;
  suggestions: TripSuggestion[];
  disruption: SpottedDisruption | null;
};

// Imprévu repéré par Biirbou dans sa réponse (#06, #08) et activités touchées à ce moment-là.
type SpottedDisruption = {
  summary: string;
  duration: string | null;
  days: string[];
  // item_id null : activité supprimée depuis (copie de ce qu'elle était).
  impacted: { item_id: number | null; day: string; start_time: string; title: string; reason: string }[];
};

type Mutate = (path: string, method: string, body?: unknown) => Promise<boolean>;

// Ce qui ouvre le panneau : un message pré-rempli (activité, budget) ou le choix d'un imprévu pour un jour.
// nonce : rouvrir avec la même demande la réapplique.
// whatNow : « Que faire maintenant ? » (voyage en cours).
export type CopilotAsk = { kind: "chat"; draft?: string } | { kind: "adapt"; day: string } | { kind: "whatNow" };
export type CopilotRequest = CopilotAsk & { nonce: number };

// Content quand une idée est acceptée (plus long que déçu : c'est le moment qu'on veut qu'il savoure).
const CHEER_MS = 2_500;
const SAD_MS = 1_500;
// La nuit (heure de l'appareil, celle du voyageur en voyage), Biirbou dort ; on le réveille en lui écrivant,
// et il se rendort AWAKE_MS après la dernière interaction.
const NIGHT_FROM_HOUR = 23;
const NIGHT_UNTIL_HOUR = 7;
const AWAKE_MS = 2 * 60_000;
const isNight = (date = new Date()) => date.getHours() >= NIGHT_FROM_HOUR || date.getHours() < NIGHT_UNTIL_HOUR;
// Bouton flottant : écrasé à l'appui, gonflé au-delà de HOLD_MS ; le clic ouvre le panneau aussitôt.
const HOLD_MS = 150;

// Heure de l'appareil avec son décalage : en voyage, l'heure locale du voyageur (revérifiée par le serveur).
function clientTimeNow() {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  const offset = -now.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  return `${localDay(now)}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
}

// Carte de la colonne de droite (onglet Planning) : présente le copilote et ouvre le panneau.
export function CopilotCard({ detail, onOpen }: { detail: TripDetail; onOpen: (request: CopilotAsk) => void }) {
  const t = useTranslations("Planner");
  const canEdit = detail.role !== "viewer";
  const moment = tripMoment(detail.trip, localDay(new Date()));
  const today = moment.kind === "during" ? localDay(new Date()) : null;

  return (
    <Card className="flex flex-col gap-4 p-6">
      <div className="flex flex-col gap-1">
        <h2 className="flex items-center gap-2 font-display text-headline-sm text-ink">
          <Biirbou animated={false} className="size-9" />
          {t("copilot.title")}
        </h2>
        <p className="text-body-sm text-ink-soft">{t(`copilot.cardText.${moment.kind}`)}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {/* Pendant le voyage (jour de la destination, calculé par le serveur ; null pour un lecteur). */}
        {detail.live && (
          <Button size="sm" onClick={() => onOpen({ kind: "whatNow" })} className="gap-1.5">
            <Icon name="explore" className="size-4" />
            {t("whatNow.open")}
          </Button>
        )}
        <Button size="sm" variant={detail.live ? "secondary" : "primary"} onClick={() => onOpen({ kind: "chat" })} className="gap-1.5">
          <Icon name="send" className="size-4" />
          {t("copilot.open")}
        </Button>
        {canEdit && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => onOpen({ kind: "adapt", day: today ?? tripDays(detail.trip.start_date, detail.trip.end_date)[0] })}
            className="gap-1.5"
          >
            <Icon name="refresh" className="size-4" />
            {t("copilot.adaptTrip")}
          </Button>
        )}
      </div>
    </Card>
  );
}

// Bouton flottant : Biirbou depuis tous les onglets du voyage (Planning, Tableau, Dépenses). Au repos, la mascotte seule
// (animée) ; au survol ou au focus, le fond blanc et l'ombre apparaissent et son nom glisse à sa droite (toujours lu par
// les lecteurs d'écran).
// mood : réfléchit (re-génération en cours), content (réussie), fatigué (quota du jour épuisé) ; oops : après un « Annuler ».
export function CopilotLauncher({ onOpen, mood = "idle", oops = 0 }: { onOpen: () => void; mood?: BiirbouMood; oops?: number }) {
  const t = useTranslations("Planner");
  const [hovered, setHovered] = useState(false);
  // Appui : il s'écrase aussitôt ; maintenu plus de HOLD_MS, il gonfle. Le clic (relâché sur le bouton) ouvre le
  // panneau tout de suite : aucune attente entre le geste et la transformation.
  const [pressed, setPressed] = useState(false);
  const [holding, setHolding] = useState(false);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  function press() {
    setPressed(true);
    holdTimer.current = setTimeout(() => {
      setPressed(false);
      setHolding(true);
    }, HOLD_MS);
  }

  function release() {
    clearTimeout(holdTimer.current);
    setPressed(false);
    setHolding(false);
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => {
        setHovered(false);
        release();
      }}
      onPointerDown={press}
      onPointerUp={release}
      onPointerCancel={release}
      // Appui long sur mobile : pas de menu contextuel ni de sélection.
      onContextMenu={(event) => event.preventDefault()}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      className="group fixed right-4 bottom-4 z-40 flex touch-manipulation items-center rounded-full select-none [-webkit-touch-callout:none] border border-transparent p-1.5 font-display text-label-lg text-ink transition-[background-color,border-color,box-shadow] duration-300 ease-out hover:border-line hover:bg-surface hover:shadow-lg focus-visible:border-line focus-visible:bg-surface focus-visible:shadow-lg focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none motion-reduce:transition-none md:right-6 md:bottom-6"
    >
      <span className="flex">
        <Biirbou
          mood={mood}
          oops={oops}
          hovered={hovered}
          pressed={pressed}
          inflating={holding}
          followPointer
          className="size-16 drop-shadow-md transition-[filter] duration-300 group-hover:drop-shadow-none group-focus-visible:drop-shadow-none"
        />
      </span>
      <span className="max-w-0 -translate-x-2 overflow-hidden whitespace-nowrap opacity-0 transition-all duration-300 ease-out group-hover:mr-3 group-hover:ml-2 group-hover:max-w-xs group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:mr-3 group-focus-visible:ml-2 group-focus-visible:max-w-xs group-focus-visible:translate-x-0 group-focus-visible:opacity-100 motion-reduce:transition-none">
        {t("copilot.launcher")}
      </span>
    </button>
  );
}

// Panneau du copilote, non modal (le planning reste visible et utilisable à côté). Toujours monté : la discussion et le
// brouillon survivent à sa fermeture. Une proposition n'est ajoutée au planning que si l'utilisateur répond oui.
export function TripCopilot({
  open,
  onClose,
  request,
  basePath,
  refreshKey,
  detail,
  mutate,
  onReload,
  onUpsell,
}: {
  open: boolean;
  onClose: () => void;
  request: CopilotRequest | null;
  basePath: string;
  refreshKey: number;
  detail: TripDetail;
  mutate: Mutate;
  // Après un message : la mémoire du voyage a pu changer.
  onReload: () => Promise<unknown>;
  onUpsell: (feature: TripPassFeature) => void;
}) {
  const t = useTranslations("Planner");
  const format = useFormatter();
  const me = parseSessionUser(getSessionSnapshot());
  const router = useRouter();
  const { trip, role, chatLimit, aiQuota, pass } = detail;
  const canEdit = role !== "viewer";
  const passActive = pass.active;
  const [messages, setMessages] = useState<TripMessage[] | null>(null);
  const [draft, setDraft] = useState("");
  const [adaptDay, setAdaptDay] = useState<string | null>(null);
  // Énergie choisie pour adapter la journée : envoyée avec le message, puis oubliée.
  const [adaptEnergy, setAdaptEnergy] = useState<TripEnergyLevel | null>(null);
  const [adaptReason, setAdaptReason] = useState<TripDisruption | null>(null);
  const [whatNow, setWhatNow] = useState(false);
  // Réponse dont on regarde l'avant / après (#12).
  const [previewId, setPreviewId] = useState<number | null>(null);
  // Message en cours d'envoi (affiché tout de suite, avant la réponse de Biirbou).
  const [pending, setPending] = useState<string | null>(null);
  const sending = pending !== null;
  const [cheering, setCheering] = useState(false);
  const [disappointed, setDisappointed] = useState(false);
  // Réponses reçues : Biirbou saute à chaque nouvelle réponse.
  const [answers, setAnswers] = useState(0);
  // Panneau rendu seulement dans le navigateur (voyage chargé par l'API) : l'heure locale est lisible dès le départ.
  const [night, setNight] = useState(() => isNight());
  const [awake, setAwake] = useState(false);
  // Réveils : un petit saut chaque fois qu'on le tire de son sommeil.
  const [wakeups, setWakeups] = useState(0);
  const sleepTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const online = useOnline();
  const [error, setError] = useState<PlannerError | null>(null);
  const panel = useRef<HTMLElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);
  const days = tripDays(trip.start_date, trip.end_date);
  const remaining = chatLimit - (messages ?? []).filter((message) => message.role === "user").length;
  // Requêtes envoyées depuis le dernier chargement du voyage : remises à zéro quand le serveur renvoie un nouveau compteur.
  const [counter, setCounter] = useState({ base: aiQuota.used, sent: 0 });
  const used = aiQuota.used + (counter.base === aiQuota.used ? counter.sent : 0);
  const quotaReached = aiQuota.limit !== null && used >= aiQuota.limit;
  // On lui écrit : il est réveillé et regarde le voyageur.
  const typing = draft.trim() !== "" && !sending;
  // Humeur de Biirbou dans le panneau (oops : refreshKey change après un « Annuler »).
  const panelMood: BiirbouMood = !online
    ? "asleep"
    : sending
      ? "thinking"
      : cheering
        ? "happy"
        : disappointed
          ? "sad"
          : quotaReached
            ? "tired"
            : night && !awake && !typing
              ? "asleep"
              : "idle";

  // La nuit commence ou finit pendant que la page est ouverte.
  useEffect(() => {
    const timer = setInterval(() => setNight(isNight()), 60_000);
    return () => {
      clearInterval(timer);
      clearTimeout(sleepTimer.current);
    };
  }, []);

  // Toute interaction le réveille (saut s'il dormait) ; il se rendort AWAKE_MS plus tard s'il fait encore nuit.
  function wake() {
    if (night && !awake) setWakeups((count) => count + 1);
    setAwake(true);
    clearTimeout(sleepTimer.current);
    sleepTimer.current = setTimeout(() => setAwake(false), AWAKE_MS);
  }

  const loadMessages = useCallback(
    () =>
      apiFetch<{ messages: TripMessage[] }>(`${basePath}/messages`).then((result) => {
        // Inchangés : on garde l'état actuel, sinon la synchronisation ramènerait la discussion en bas toutes les 30 s.
        if ("data" in result) {
          const next = result.data.messages;
          return setMessages((current) => (JSON.stringify(current) === JSON.stringify(next) ? current : next));
        }
        if (result.error === "UNAUTHORIZED") return router.replace("/login");
        setError(plannerError(result.error));
      }),
    [basePath, router],
  );

  useEffect(() => {
    void loadMessages();
  }, [loadMessages, refreshKey]);

  // Demande reçue (activité, budget, imprévu) : appliquée une fois, pendant le rendu (pas d'effet en cascade).
  const [appliedNonce, setAppliedNonce] = useState<number | null>(null);
  if (request && request.nonce !== appliedNonce) {
    setAppliedNonce(request.nonce);
    setAdaptDay(request.kind === "adapt" ? request.day : null);
    setAdaptEnergy(null);
    setAdaptReason(null);
    if (request.kind === "chat" && request.draft) setDraft(request.draft);
    if (request.kind === "whatNow") setWhatNow(true);
  }

  // Focus dans le panneau à l'ouverture, rendu au bouton qui l'a ouvert à la fermeture.
  useEffect(() => {
    if (open) {
      opener.current = document.activeElement;
      (input.current ?? panel.current)?.focus();
    } else if (opener.current instanceof HTMLElement) {
      opener.current.focus();
      opener.current = null;
    }
  }, [open]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [messages, sending, open]);

  // context : énergie, position ou lieu (« Que faire maintenant ? », « Adapter ma journée »), envoyés avec ce message seulement.
  async function send(content: string, context: Omit<TripMessageContext, "clientTime"> = {}) {
    if (content.length < 2 || sending) return false;
    wake();
    if (quotaReached) {
      if (!passActive) onUpsell("ai");
      return false;
    }

    setPending(content);
    setError(null);
    const result = await apiFetch<{ messages: TripMessage[] }>(`${basePath}/messages`, {
      method: "POST",
      body: { content, clientTime: clientTimeNow(), ...context },
    });
    setPending(null);

    if ("data" in result) {
      setMessages(result.data.messages);
      setAnswers((count) => count + 1);
      setCounter({ base: aiQuota.used, sent: used - aiQuota.used + 1 });
      void onReload();
      return true;
    }
    if (result.error === "UNAUTHORIZED") {
      router.replace("/login");
      return false;
    }
    if (result.error === "DAILY_LIMIT_REACHED" && aiQuota.limit !== null) setCounter({ base: aiQuota.used, sent: aiQuota.limit - aiQuota.used });
    // Sans pass : le pass est proposé à la place du message d'erreur.
    if (!passActive && (result.error === "DAILY_LIMIT_REACHED" || result.error === "CHAT_LIMIT_REACHED")) {
      onUpsell(result.error === "DAILY_LIMIT_REACHED" ? "ai" : "chat");
      return false;
    }
    setError(plannerError(result.error));
    return false;
  }

  // Motif choisi : phrase fixe affichée dans la discussion, suivie des précisions du voyageur ; le serveur reçoit
  // aussi le motif comme valeur connue (disruption), qu'il traduit lui-même pour Biirbou.
  const adaptPrefix =
    adaptDay && adaptReason
      ? t("copilot.adapt.message", {
          number: days.indexOf(adaptDay) + 1,
          date: format.dateTime(parseDay(adaptDay), { weekday: "long", day: "numeric", month: "long" }),
          reason: t(`copilot.adapt.reasons.${adaptReason}.text`),
        })
      : null;

  async function sendDraft() {
    const content = [adaptPrefix, draft.trim()].filter(Boolean).join("\n");
    const context = adaptDay
      ? { ...(adaptEnergy && { energy: adaptEnergy }), ...(adaptReason && { disruption: { reason: adaptReason, day: adaptDay } }) }
      : {};
    const sent = await send(content, context);
    if (!sent) return;
    setDraft("");
    setAdaptDay(null);
    setAdaptEnergy(null);
    setAdaptReason(null);
  }

  function openWhatNow() {
    if (quotaReached && !passActive) return onUpsell("ai");
    setWhatNow(true);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendDraft();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void sendDraft();
    }
  }

  const previewMessage = messages?.find((message) => message.id === previewId) ?? null;
  const previewPending = previewMessage?.suggestions.filter((item) => item.status === "pending") ?? [];

  // « Tout accepter » : les propositions en attente de cette réponse, en un seul changement (un seul « Annuler »).
  async function acceptAll(message: TripMessage) {
    const ok = await mutate(`/messages/${message.id}/accept`, "POST");
    if (ok) {
      setCheering(true);
      setTimeout(() => setCheering(false), CHEER_MS);
    }
    // Statut de chaque proposition (une périmée a pu être refusée) : relu depuis le serveur.
    void loadMessages();
  }

  async function answer(suggestion: TripSuggestion, accepted: boolean) {
    wake();
    const ok = await mutate(`/suggestions/${suggestion.id}`, "PATCH", { accepted });
    if (!ok) return loadMessages();
    // Content quand une de ses idées entre dans le planning, déçu quand elle est refusée.
    const setMood = accepted ? setCheering : setDisappointed;
    setMood(true);
    setTimeout(() => setMood(false), accepted ? CHEER_MS : SAD_MS);
    const status = accepted ? "accepted" : "rejected";
    setMessages((current) =>
      (current ?? []).map((message) => ({
        ...message,
        suggestions: message.suggestions.map((item) => (item.id === suggestion.id ? { ...item, status } : item)),
      })),
    );
  }

  return (
    <aside
      ref={panel}
      tabIndex={-1}
      aria-label={t("copilot.panelLabel")}
      onKeyDown={(event) => {
        // Échap dans une fenêtre ouverte depuis le panneau (« Que faire maintenant ? ») ne ferme que cette fenêtre.
        if (event.key === "Escape" && !(event.target instanceof Element && event.target.closest("dialog"))) onClose();
      }}
      className={`fixed inset-y-0 right-0 z-50 w-full flex-col border-l ${open ? "flex" : "hidden"} border-line bg-surface shadow-lg focus-visible:outline-none sm:w-[26rem]`}
    >
      <div className="flex items-start justify-between gap-3 border-b border-line px-5 pt-5 pb-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="flex items-center gap-2 font-display text-headline-sm text-ink">
            {/* Animé dans le panneau : dort la nuit, se réveille quand on lui écrit et te regarde, réfléchit pendant la réponse,
                content quand une idée est acceptée ; immobile dans le planning. */}
            <Biirbou mood={panelMood} bounce={answers + wakeups} oops={refreshKey} hovered={typing} followPointer className="size-10" />
            {t("copilot.title")}
          </h2>
          <p className="truncate text-label-sm text-ink-soft">{trip.title}</p>
        </div>
        <IconButton icon="close" label={t("copilot.close")} onClick={onClose} />
      </div>

      <div ref={scroller} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
        <CopilotContext detail={detail} mutate={mutate} />

        {/* Combien de fois Biirbou peut encore aider aujourd'hui (rien pour un compte sans limite). */}
        {canEdit && aiQuota.limit !== null && !quotaReached && (
          <p aria-live="polite" className="inline-flex items-center gap-1.5 self-start rounded-lg bg-surface-muted px-2.5 py-1 text-label-sm text-ink-soft">
            <Icon name="sparkles" className="size-3.5 text-accent" />
            {t.rich("chat.left", {
              count: Math.max(0, aiQuota.limit - used),
              strong: (chunks) => <strong className="font-semibold text-ink">{chunks}</strong>,
            })}
          </p>
        )}

        <div className="flex flex-col gap-3" aria-live="polite">
          {messages === null && !error && <div className="h-16 animate-pulse rounded-lg bg-surface-muted" aria-hidden="true" />}
          {messages?.length === 0 && <p className="text-body-sm text-ink-soft">{t("chat.empty")}</p>}

          {messages?.map((message) =>
            message.role === "user" ? (
              <div key={message.id} className="flex max-w-[85%] flex-col items-end gap-0.5 self-end">
                {/* Discussion partagée : on nomme les autres membres. */}
                {message.author && message.author.id !== me?.id && (
                  <span className="text-label-sm text-ink-soft">{message.author.display_name}</span>
                )}
                <p className="rounded-lg bg-ink px-3 py-2 text-body-sm whitespace-pre-line text-surface">{message.content}</p>
              </div>
            ) : (
              <div key={message.id} className="flex max-w-[95%] flex-col gap-2 self-start">
                <p
                  className={`rounded-lg bg-surface-muted px-3 py-2 text-body-sm whitespace-pre-line ${
                    message.off_topic ? "text-ink-soft italic" : "text-ink"
                  }`}
                >
                  {message.off_topic ? t("chat.offTopic") : message.content}
                </p>
                {message.disruption && <DisruptionCard disruption={message.disruption} days={days} />}
                {message.suggestions.length > 0 && (
                  <ul className="flex flex-col gap-2" aria-label={t("chat.suggestions")}>
                    {message.suggestions.map((suggestion) => (
                      <SuggestionCard
                        key={suggestion.id}
                        suggestion={suggestion}
                        days={days}
                        // En attente seulement : une fois acceptée, l'activité est dans le planning et s'y compare.
                        warnings={
                          suggestion.status === "pending" && suggestion.action !== "delete"
                            ? itemWarnings(suggestion, detail.items, suggestion.target?.id)
                            : []
                        }
                        onAnswer={canEdit ? (accepted) => answer(suggestion, accepted) : undefined}
                      />
                    ))}
                  </ul>
                )}
                {message.suggestions.some((item) => item.status === "pending") && (
                  <div className="flex flex-wrap items-center gap-2">
                    {canEdit && message.suggestions.filter((item) => item.status === "pending").length > 1 && (
                      <Button size="sm" onClick={() => void acceptAll(message)} className="gap-1.5">
                        <Icon name="check" className="size-4" />
                        {t("chat.acceptAll", { count: message.suggestions.filter((item) => item.status === "pending").length })}
                      </Button>
                    )}
                    <Button size="sm" variant="secondary" onClick={() => setPreviewId(message.id)} className="gap-1.5">
                      <Icon name="visibility" className="size-4" />
                      {t("chat.preview.open")}
                    </Button>
                  </div>
                )}
              </div>
            ),
          )}

          {sending && (
            <>
              <p className="max-w-[85%] self-end rounded-lg bg-ink px-3 py-2 text-body-sm whitespace-pre-line text-surface">
                {pending}
              </p>
              <div className="self-start rounded-lg bg-surface-muted px-3 py-2">
                <ReasoningText phrases={t.raw("chat.reasoning") as string[]} />
              </div>
            </>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-3 border-t border-line px-5 pt-4 pb-5">
        {canEdit && adaptDay && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <p className="font-display text-label-lg text-ink">
                {t("copilot.adapt.title", {
                  number: days.indexOf(adaptDay) + 1,
                  date: format.dateTime(parseDay(adaptDay), { day: "numeric", month: "short" }),
                })}
              </p>
              <IconButton
                icon="close"
                label={t("copilot.adapt.dismiss")}
                onClick={() => {
                  setAdaptDay(null);
                  setAdaptReason(null);
                }}
              />
            </div>
            <FilterBar label={t("copilot.adapt.reasonsLabel")}>
              {TRIP_DISRUPTIONS.map((reason) => (
                <FilterChip
                  key={reason}
                  active={adaptReason === reason}
                  onClick={() => {
                    setAdaptReason((current) => (current === reason ? null : reason));
                    input.current?.focus();
                  }}
                >
                  {t(`copilot.adapt.reasons.${reason}.label`)}
                </FilterChip>
              ))}
            </FilterBar>
            <FilterBar label={t("whatNow.energy.label")}>
              {TRIP_ENERGY_LEVELS.map((level) => (
                <FilterChip key={level} active={adaptEnergy === level} onClick={() => setAdaptEnergy((current) => (current === level ? null : level))}>
                  <Icon name={ENERGY_ICONS[level]} className="size-4" />
                  {t(`whatNow.energy.${level}`)}
                </FilterChip>
              ))}
            </FilterBar>
          </div>
        )}

        {/* Pendant le voyage : aussi depuis le panneau (ouvert depuis n'importe quel onglet). */}
        {canEdit && detail.live && remaining > 0 && !adaptDay && (
          <Button size="sm" variant="secondary" onClick={openWhatNow} disabled={sending} className="gap-1.5 self-start">
            <Icon name="explore" className="size-4" />
            {t("whatNow.open")}
          </Button>
        )}

        {error && <FormError>{t(`errors.${error}`)}</FormError>}

        {!canEdit ? (
          <p className="text-body-sm text-ink-soft">{t("share.viewerChat")}</p>
        ) : remaining > 0 ? (
          <form onSubmit={handleSubmit} className="flex flex-col gap-2">
            <label htmlFor="chat-message" className="sr-only">
              {t("chat.label")}
            </label>
            <div className="flex items-end gap-2">
              <Textarea
                ref={input}
                id="chat-message"
                value={draft}
                onChange={(event) => {
                  setDraft(event.currentTarget.value);
                  wake();
                }}
                onKeyDown={handleKeyDown}
                minLength={adaptPrefix ? undefined : 2}
                maxLength={TRIP_MESSAGE_MAX - (adaptPrefix ? adaptPrefix.length + 1 : 0)}
                rows={2}
                placeholder={t(adaptPrefix ? "copilot.adapt.details" : "chat.placeholder")}
                required={!adaptPrefix}
                className="max-h-40"
              />
              {quotaReached && !passActive ? (
                <Button onClick={() => onUpsell("ai")} className="shrink-0 gap-1.5">
                  <Icon name="sparkles" className="size-4.5" />
                  {t("chat.upgrade")}
                </Button>
              ) : (
                <Button type="submit" disabled={sending || messages === null || quotaReached} aria-label={t("chat.send")} className="shrink-0 px-3">
                  <Icon name="send" className="size-5" />
                </Button>
              )}
            </div>
            {quotaReached ? (
              <p className="text-label-sm text-ink-soft">{t(passActive ? "chat.quotaReachedPass" : "chat.quotaReached")}</p>
            ) : (
              remaining <= 10 && <p className="text-label-sm text-ink-soft">{t("chat.remaining", { count: remaining })}</p>
            )}
          </form>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-body-sm text-ink-soft">{t("errors.CHAT_LIMIT_REACHED")}</p>
            {!passActive && (
              <Button size="sm" onClick={() => onUpsell("chat")} className="gap-1.5">
                <Icon name="sparkles" className="size-4" />
                {t("chat.upgrade")}
              </Button>
            )}
          </div>
        )}
      </div>

      {detail.live && (
        <WhatNowDialog
          open={whatNow}
          dayNumber={detail.live.dayNumber}
          onClose={() => setWhatNow(false)}
          onAsk={(context) => {
            setWhatNow(false);
            void send(t("whatNow.message"), context);
          }}
        />
      )}

      {previewMessage && (
        <TripChangePreview
          open
          onClose={() => setPreviewId(null)}
          items={detail.items}
          days={days}
          suggestions={previewPending}
          onAccept={
            canEdit
              ? () => {
                  setPreviewId(null);
                  void (previewPending.length === 1 ? answer(previewPending[0], true) : acceptAll(previewMessage));
                }
              : undefined
          }
        />
      )}
    </aside>
  );
}

// « Biirbou sait que… » : ce que le copilote reçoit avec chaque message (mêmes données que le prompt, côté serveur).
function CopilotContext({ detail, mutate }: { detail: TripDetail; mutate: Mutate }) {
  const t = useTranslations("Planner");
  const format = useFormatter();
  const { trip, items, spending, role } = detail;
  const today = localDay(new Date());
  const moment = tripMoment(trip, today);
  const todayCount = items.filter((item) => item.day === today).length;
  const places = trip.destinations.length > 0 ? trip.destinations : [{ country_code: trip.destination_country_code, city: trip.destination_city }];
  const money = (minor: number) =>
    format.number(minor / 10 ** currencyDecimals(spending.currency), {
      style: "currency",
      currency: spending.currency,
      maximumFractionDigits: 0,
    });

  return (
    // Ouvert pendant le voyage : c'est là que le voyageur a besoin de voir ce que Biirbou sait de sa journée.
    <details open={moment.kind === "during"} className="group rounded-lg bg-surface-muted p-4 text-body-sm text-ink-soft">
      <summary className="flex cursor-pointer items-center justify-between gap-2 font-display text-label-lg text-ink">
        {t("copilot.context.title")}
        <Icon name="chevronDown" className="size-4 transition group-open:rotate-180" />
      </summary>
      <ul className="mt-3 flex flex-col gap-2">
        <li>
          {t("copilot.context.trip", {
            places: places.map((place) => place.city ?? countryName(place.country_code, "fr")).join(", "),
            dates: format.dateTimeRange(parseDay(trip.start_date), parseDay(trip.end_date), { day: "numeric", month: "short" }),
            travelers: trip.traveler_count,
          })}
        </li>
        <li>
          {moment.kind === "during"
            ? t("copilot.context.during", { day: moment.day, total: moment.total, count: todayCount })
            : moment.kind === "before"
              ? t("copilot.context.before", { days: moment.days })
              : t("copilot.context.after")}
        </li>
        <li>
          {t("copilot.context.budget", {
            planned: spending.budget_minor === null ? `${budgetTotal(trip)} €` : money(spending.budget_minor),
            spent: money(spending.total_minor),
          })}
        </li>
        {trip.instructions && <li>{t("copilot.context.wishes")}</li>}
        <li>{t("copilot.context.plan", { count: items.length })}</li>
        <li className="flex gap-1.5 text-ink">
          <Icon name="info" className="mt-0.5 size-4 shrink-0" />
          {t("copilot.context.limits")}
        </li>
      </ul>
      <CopilotMemory memory={trip.memory} canEdit={role !== "viewer"} mutate={mutate} />
    </details>
  );
}

// Mémoire du voyage (#36) : retenue par Biirbou, visible par tous les membres, corrigée ou effacée par les éditeurs.
function CopilotMemory({ memory, canEdit, mutate }: { memory: string | null; canEdit: boolean; mutate: Mutate }) {
  const t = useTranslations("Planner");
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(false);

  async function save(value: string | null) {
    setPending(true);
    if (await mutate("", "PATCH", { memory: value ?? "" })) setEditing(false);
    setPending(false);
  }

  return (
    <div className="mt-4 flex flex-col gap-2 border-t border-line pt-3">
      <p className="font-display text-label-lg text-ink">{t("copilot.memory.title")}</p>
      {editing ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save(String(new FormData(event.currentTarget).get("memory") ?? ""));
          }}
          className="flex flex-col gap-2"
        >
          <label htmlFor="trip-memory" className="sr-only">
            {t("copilot.memory.title")}
          </label>
          <Textarea id="trip-memory" name="memory" defaultValue={memory ?? ""} maxLength={TRIP_MEMORY_MAX} rows={4} autoFocus />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="secondary" onClick={() => setEditing(false)}>
              {t("item.cancel")}
            </Button>
            <Button type="submit" size="sm" disabled={pending}>
              {t("item.save")}
            </Button>
          </div>
        </form>
      ) : (
        <>
          <p className="whitespace-pre-line">{memory ?? t("copilot.memory.empty")}</p>
          {canEdit && (
            <div className="flex gap-3">
              <button type="button" onClick={() => setEditing(true)} className="text-label-md font-medium text-accent hover:underline">
                {t("copilot.memory.edit")}
              </button>
              {memory && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => void save(null)}
                  className="text-label-md font-medium text-ink-soft hover:text-ink hover:underline"
                >
                  {t("copilot.memory.clear")}
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SuggestionCard({
  suggestion,
  days,
  warnings,
  onAnswer,
}: {
  suggestion: TripSuggestion;
  days: string[];
  warnings: ItemWarning[];
  // Absent : lecteur, la proposition est affichée sans boutons.
  onAnswer?: (accepted: boolean) => Promise<unknown>;
}) {
  const t = useTranslations("Planner");
  const format = useFormatter();
  const [pending, setPending] = useState(false);

  async function handleAnswer(accepted: boolean) {
    if (!onAnswer) return;
    setPending(true);
    await onAnswer(accepted);
    setPending(false);
  }

  return (
    <li
      className={`flex flex-col gap-1.5 rounded-lg border border-line p-3 ${
        suggestion.status === "rejected" ? "opacity-60" : "bg-surface"
      }`}
    >
      <span className="flex flex-wrap items-center gap-1.5 text-label-sm text-ink-soft">
        <Badge tone={suggestion.action === "delete" ? "danger" : suggestion.action === "update" ? "accent" : "neutral"}>
          {t(`chat.actions.${suggestion.action}`)}
        </Badge>
        <Icon name={CATEGORY_ICONS[suggestion.category]} className="size-4" />
        {t("chat.suggestionWhen", {
          number: days.indexOf(suggestion.day) + 1,
          date: format.dateTime(parseDay(suggestion.day), { day: "numeric", month: "short" }),
          time: suggestion.start_time,
        })}
      </span>
      <span className={`font-display text-label-lg text-ink ${suggestion.action === "delete" ? "line-through" : ""}`}>
        {suggestion.title}
      </span>
      {suggestion.action === "update" && suggestion.target && (
        <span className="text-label-sm text-ink-soft">
          {t("chat.before", {
            date: format.dateTime(parseDay(suggestion.target.day), { day: "numeric", month: "short" }),
            time: suggestion.target.start_time,
            title: suggestion.target.title,
          })}
        </span>
      )}
      {suggestion.description && <p className="text-body-sm text-ink-soft">{suggestion.description}</p>}
      <ItemWarnings warnings={warnings} days={days} />
      {suggestion.action !== "delete" && (
        <p className="flex flex-wrap items-center gap-1.5 text-body-sm text-ink-soft">
          {suggestion.source_post ? (
            <>
              <Badge tone="accent">{t("origin.post")}</Badge>
              <Link href={`/post/${suggestion.source_post.slug}`} className="font-medium text-accent hover:underline">
                {suggestion.source_post.title}
              </Link>
            </>
          ) : (
            <Badge>{t("origin.ai")}</Badge>
          )}
          {/* Rien n'est vérifié en direct (#69) : ni horaires, ni prix, ni accès, même tiré d'un récit. */}
          <span className="flex items-center gap-1 text-label-sm">
            <Icon name="info" className="size-3.5 shrink-0" />
            {t("origin.toVerify")}
          </span>
        </p>
      )}

      {suggestion.status === "pending" && !onAnswer ? null : suggestion.status === "pending" ? (
        <div className="mt-1 flex items-center gap-2">
          <span className="mr-auto text-label-sm text-ink-soft">{t(`chat.questions.${suggestion.action}`)}</span>
          <Button size="sm" variant="secondary" disabled={pending} onClick={() => void handleAnswer(false)}>
            {t("chat.no")}
          </Button>
          <Button size="sm" disabled={pending} onClick={() => void handleAnswer(true)}>
            <Icon name="check" className="size-4" />
            {t("chat.yes")}
          </Button>
        </div>
      ) : (
        <span
          className={`mt-1 flex items-center gap-1.5 text-label-sm ${suggestion.status === "accepted" ? "text-accent" : "text-ink-soft"}`}
        >
          {suggestion.status === "accepted" && <Icon name="check" className="size-4" />}
          {suggestion.status === "accepted" ? t(`chat.applied.${suggestion.action}`) : t("chat.rejected")}
        </span>
      )}
    </li>
  );
}

// Ce que Biirbou a compris de l'imprévu : quoi, combien de temps, quels jours et quelles activités (avec la raison).
function DisruptionCard({ disruption, days }: { disruption: SpottedDisruption; days: string[] }) {
  const t = useTranslations("Planner");
  const format = useFormatter();
  const dayLabel = (day: string) =>
    t("chat.disruption.day", { number: days.indexOf(day) + 1, date: format.dateTime(parseDay(day), { day: "numeric", month: "short" }) });
  const when = [disruption.days.map(dayLabel).join(", "), disruption.duration].filter(Boolean).join(" · ");

  return (
    <section aria-label={t("chat.disruption.label")} className="flex flex-col gap-2 rounded-lg border border-line bg-surface px-3 py-2.5">
      <div className="flex items-start gap-2">
        <Icon name="warning" className="mt-0.5 size-4 shrink-0 text-accent" />
        <div className="flex min-w-0 flex-col">
          <p className="font-display text-label-lg text-ink first-letter:uppercase">{disruption.summary}</p>
          {when && <p className="text-label-sm text-ink-soft">{when}</p>}
        </div>
      </div>
      {disruption.impacted.length > 0 ? (
        <ul aria-label={t("chat.disruption.impacted")} className="flex flex-col gap-1 border-t border-line pt-2">
          {disruption.impacted.map((item) => (
            <li key={`${item.day}-${item.start_time}-${item.title}`} className="text-body-sm text-ink">
              <span className="font-display text-label-md">
                {disruption.days.length > 1 && `${dayLabel(item.day)} · `}
                {item.start_time} {item.title}
              </span>
              <span className="text-ink-soft"> — {item.reason}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="border-t border-line pt-2 text-body-sm text-ink-soft">{t("chat.disruption.none")}</p>
      )}
    </section>
  );
}
