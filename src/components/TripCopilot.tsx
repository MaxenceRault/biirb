"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Badge } from "@/components/ui/Badge";
import { Biirbou } from "@/components/ui/Biirbou";
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
import { TRIP_MEMORY_MAX, TRIP_MESSAGE_MAX } from "@/schemas/trip.schema";

type TripSuggestion = Omit<TripItem, "id" | "color" | "origin"> & {
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
};

type Mutate = (path: string, method: string, body?: unknown) => Promise<boolean>;

// Ce qui ouvre le panneau : un message pré-rempli (activité, budget) ou le choix d'un imprévu pour un jour.
// nonce : rouvrir avec la même demande la réapplique.
export type CopilotAsk = { kind: "chat"; draft?: string } | { kind: "adapt"; day: string };
export type CopilotRequest = CopilotAsk & { nonce: number };

// Motifs d'imprévus proposés par « Adapter mon voyage » (textes dans messages/fr.json → Planner.copilot.adapt).
const ADAPT_REASONS = ["rain", "tired", "late", "closed", "budget", "other"] as const;

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
          <Biirbou animated={false} className="size-7" />
          {t("copilot.title")}
        </h2>
        <p className="text-body-sm text-ink-soft">{t(`copilot.cardText.${moment.kind}`)}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => onOpen({ kind: "chat" })} className="gap-1.5">
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
export function CopilotLauncher({ onOpen, tired = false }: { onOpen: () => void; tired?: boolean }) {
  const t = useTranslations("Planner");
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="button"
      onClick={onOpen}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      className="group fixed right-4 bottom-4 z-40 flex items-center rounded-full border border-transparent p-1.5 font-display text-label-lg text-ink transition-all duration-300 ease-out hover:border-line hover:bg-surface hover:shadow-lg focus-visible:border-line focus-visible:bg-surface focus-visible:shadow-lg focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none motion-reduce:transition-none md:right-6 md:bottom-6"
    >
      {/* Quota du jour épuisé : Biirbou est fatigué. */}
      <Biirbou
        mood={tired ? "tired" : "idle"}
        hovered={hovered}
        followPointer
        className="size-12 drop-shadow-md transition-[filter] duration-300 group-hover:drop-shadow-none group-focus-visible:drop-shadow-none"
      />
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
  const [sending, setSending] = useState(false);
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

  const loadMessages = useCallback(
    () =>
      apiFetch<{ messages: TripMessage[] }>(`${basePath}/messages`).then((result) => {
        if ("data" in result) return setMessages(result.data.messages);
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
    if (request.kind === "chat" && request.draft) setDraft(request.draft);
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

  async function send() {
    const content = draft.trim();
    if (content.length < 2 || sending) return;
    if (quotaReached) return passActive ? undefined : onUpsell("ai");

    setSending(true);
    setError(null);
    const result = await apiFetch<{ messages: TripMessage[] }>(`${basePath}/messages`, {
      method: "POST",
      body: { content, clientTime: clientTimeNow() },
    });
    setSending(false);

    if ("data" in result) {
      setMessages(result.data.messages);
      setDraft("");
      setAdaptDay(null);
      setCounter({ base: aiQuota.used, sent: used - aiQuota.used + 1 });
      void onReload();
      return;
    }
    if (result.error === "UNAUTHORIZED") return router.replace("/login");
    if (result.error === "DAILY_LIMIT_REACHED" && aiQuota.limit !== null) setCounter({ base: aiQuota.used, sent: aiQuota.limit - aiQuota.used });
    // Sans pass : le pass est proposé à la place du message d'erreur.
    if (!passActive && (result.error === "DAILY_LIMIT_REACHED" || result.error === "CHAT_LIMIT_REACHED")) {
      return onUpsell(result.error === "DAILY_LIMIT_REACHED" ? "ai" : "chat");
    }
    setError(plannerError(result.error));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void send();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send();
    }
  }

  function chooseReason(reason: (typeof ADAPT_REASONS)[number], day: string) {
    setDraft(
      t("copilot.adapt.message", {
        number: days.indexOf(day) + 1,
        date: format.dateTime(parseDay(day), { weekday: "long", day: "numeric", month: "long" }),
        reason: t(`copilot.adapt.reasons.${reason}.text`),
      }),
    );
    input.current?.focus();
  }

  async function answer(suggestion: TripSuggestion, accepted: boolean) {
    const ok = await mutate(`/suggestions/${suggestion.id}`, "PATCH", { accepted });
    if (!ok) return loadMessages();
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
        if (event.key === "Escape") onClose();
      }}
      className={`fixed inset-y-0 right-0 z-50 w-full flex-col border-l ${open ? "flex" : "hidden"} border-line bg-surface shadow-lg focus-visible:outline-none sm:w-[26rem]`}
    >
      <div className="flex items-start justify-between gap-3 border-b border-line px-5 pt-5 pb-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="flex items-center gap-2 font-display text-headline-sm text-ink">
            <Biirbou animated={false} className="size-8" />
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
                {message.suggestions.length > 0 && (
                  <ul className="flex flex-col gap-2" aria-label={t("chat.suggestions")}>
                    {message.suggestions.map((suggestion) => (
                      <SuggestionCard
                        key={suggestion.id}
                        suggestion={suggestion}
                        dayNumber={days.indexOf(suggestion.day) + 1}
                        onAnswer={canEdit ? (accepted) => answer(suggestion, accepted) : undefined}
                      />
                    ))}
                  </ul>
                )}
              </div>
            ),
          )}

          {sending && (
            <>
              <p className="max-w-[85%] self-end rounded-lg bg-ink px-3 py-2 text-body-sm whitespace-pre-line text-surface">
                {draft.trim()}
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
              <IconButton icon="close" label={t("copilot.adapt.dismiss")} onClick={() => setAdaptDay(null)} />
            </div>
            <ul className="flex flex-wrap gap-2" aria-label={t("copilot.adapt.reasonsLabel")}>
              {ADAPT_REASONS.map((reason) => (
                <li key={reason}>
                  <button
                    type="button"
                    onClick={() => chooseReason(reason, adaptDay)}
                    className="rounded-full border border-line px-3 py-1.5 text-label-md text-ink transition hover:border-accent hover:text-accent focus-visible:ring-2 focus-visible:ring-accent/25 focus-visible:outline-none"
                  >
                    {t(`copilot.adapt.reasons.${reason}.label`)}
                  </button>
                </li>
              ))}
            </ul>
          </div>
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
                onChange={(event) => setDraft(event.currentTarget.value)}
                onKeyDown={handleKeyDown}
                minLength={2}
                maxLength={TRIP_MESSAGE_MAX}
                rows={2}
                placeholder={t("chat.placeholder")}
                required
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
  dayNumber,
  onAnswer,
}: {
  suggestion: TripSuggestion;
  dayNumber: number;
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
          number: dayNumber,
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
