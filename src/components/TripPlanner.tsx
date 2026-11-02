"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { Badge } from "@/components/ui/Badge";
import { ReasoningText } from "@/components/ui/ReasoningText";
import { Button, buttonClassName } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Checkbox } from "@/components/ui/Checkbox";
import { Field } from "@/components/ui/Field";
import { FormError } from "@/components/ui/FormError";
import { Icon, type IconName } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import { FIELD_CLASS_NAME, Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { countryName, flagEmoji } from "@/lib/country";
import type { Archetype } from "@/lib/posts";
import { apiDownload, apiFetch, getSessionSnapshot, parseSessionUser } from "@/client/session";
import { TripExpenses } from "@/components/TripExpenses";
import { useOnline } from "@/client/hooks/useOnline";
import { TripMap, type TripMapData } from "@/components/TripMap";
import { TripSharePanel, type TripRole } from "@/components/TripSharePanel";
import { buildTripCsv, downloadFile } from "@/client/tripExport";
import { TripPassCard, TripPassDialog, type TripPass, type TripPassFeature } from "@/components/TripPassCard";
import { exportFileName } from "@/lib/fileName";
import { TripTableView } from "@/components/TripTableView";
import {
  TRIP_PDF_TEMPLATES,
  TRIP_UNDO_HOURS,
  type TripItemColor,
  type TripPdfTemplate,
  type TripPlanChangeKind,
} from "@/schemas/trip.schema";
import { useDismiss } from "@/client/hooks/useDismiss";

const ITEM_CATEGORIES = ["transport", "lodging", "activity", "food"] as const;
export type ItemCategory = (typeof ITEM_CATEGORIES)[number];

export type Trip = {
  // Identifiant public (UUID).
  id: string;
  title: string;
  destination_country_code: string;
  destination_city: string | null;
  start_date: string;
  end_date: string;
  archetype: Archetype;
  budget_lodging: number;
  budget_transit: number;
  budget_dining: number;
  budget_activities: number;
  budget_target: number | null;
  source_post_count: number;
  generated_at: string | null;
  // null pour un voyage généré avant l'ajout des notes de saison.
  season_note: string | null;
  // Étapes choisies (ordre de saisie ; la première est destination_*). Biirbou décide du parcours.
  destinations: { country_code: string; state_code: string | null; city: string | null }[];
  // Envies données à Biirbou à la création.
  instructions: string | null;
  traveler_count: number;
};

export type TripItem = {
  id: number;
  day: string;
  start_time: string;
  title: string;
  description: string | null;
  category: ItemCategory;
  // null : couleur de la catégorie (vue Tableau, PDF).
  color: TripItemColor | null;
  source_post: { id: number; title: string; slug: string } | null;
};

export type TripTask = { id: number; label: string; detail: string | null; done: boolean };

// Bouton d'une fonction du pass sur un voyage sans pass : grisé, mais cliquable (ouvre la fenêtre du pass).
const LOCKED_BUTTON = "text-ink-soft opacity-60 hover:opacity-90";

export type TripDetail = {
  trip: Trip;
  items: TripItem[];
  tasks: TripTask[];
  role: TripRole;
  pass: TripPass;
  // Messages possibles dans la discussion IA (plus avec le pass).
  chatLimit: number;
  // Pass voyage : lien Google Maps de chaque jour (AAAA-MM-JJ).
  mapsUrls: Record<string, string> | null;
  // Requêtes IA du jour de l'utilisateur (limit null : illimité).
  aiQuota: { used: number; limit: number | null };
  // Carte : villes citées dans le planning, avec leurs jours.
  map: TripMapData;
  // Dernier changement de Biirbou encore annulable (null : rien, délai passé, planning modifié depuis, ou lecteur).
  undo: { kind: TripPlanChangeKind; created_at: string } | null;
};

type TripSuggestion = Omit<TripItem, "id" | "color"> & {
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

// Alignée sur trip.schema.
const CHAT_MESSAGE_MAX = 500;

const PLANNER_ERRORS = [
  "INVALID_INPUT",
  "TRIP_TOO_LONG",
  "INSTRUCTIONS_REJECTED",
  "TOO_MANY_REQUESTS",
  "AI_UNAVAILABLE",
  "CHAT_LIMIT_REACHED",
  "SUGGESTION_OUTDATED",
  "NOTHING_TO_UNDO",
  "PLAN_CHANGED",
  "DAILY_LIMIT_REACHED",
  "AI_DISABLED",
  "FORBIDDEN",
  "PASS_REQUIRED",
  "PASS_ALREADY_ACTIVE",
  "PASS_UNAVAILABLE",
  "NOT_FOUND",
  "UNAUTHORIZED",
  "INTERNAL_ERROR",
] as const;
export type PlannerError = (typeof PLANNER_ERRORS)[number];

export function plannerError(code: string): PlannerError {
  return (PLANNER_ERRORS as readonly string[]).includes(code) ? (code as PlannerError) : "INTERNAL_ERROR";
}

export const CATEGORY_ICONS: Record<ItemCategory, IconName> = {
  transport: "train",
  lodging: "hotel",
  activity: "explore",
  food: "restaurant",
};

const BUDGET_FIELDS = [
  { key: "budget_lodging", body: "budgetLodging", label: "lodging" },
  { key: "budget_transit", body: "budgetTransit", label: "transit" },
  { key: "budget_dining", body: "budgetDining", label: "dining" },
  { key: "budget_activities", body: "budgetActivities", label: "activities" },
] as const;

// Midi local : la date ne glisse pas selon le fuseau horaire.
export function parseDay(day: string) {
  return new Date(`${day}T12:00:00`);
}

export function tripDays(start: string, end: string) {
  const days: string[] = [];
  for (let date = parseDay(start); date <= parseDay(end); date.setDate(date.getDate() + 1)) {
    days.push(
      `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`,
    );
  }
  return days;
}

export function budgetTotal(trip: Trip) {
  return trip.budget_lodging + trip.budget_transit + trip.budget_dining + trip.budget_activities;
}

type Mutate = (path: string, method: string, body?: unknown) => Promise<boolean>;

type LoadState = { status: "loading" } | { status: "error"; error: PlannerError } | { status: "ready"; data: TripDetail };

export function TripPlanner({ tripId }: { tripId: string }) {
  const t = useTranslations("Planner");
  const router = useRouter();
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [error, setError] = useState<PlannerError | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [undoing, setUndoing] = useState(false);
  // Incrémenté après une annulation : la discussion relit ses propositions (une proposition annulée redevient en attente).
  const [chatVersion, setChatVersion] = useState(0);
  const [sharing, setSharing] = useState(false);
  const [view, setView] = useState<"plan" | "table" | "expenses">("plan");
  const [passFeature, setPassFeature] = useState<TripPassFeature | null>(null);
  const online = useOnline();
  const basePath = `/api/v1/trips/${tripId}`;

  useEffect(() => {
    if (!getSessionSnapshot()) return router.replace("/login");

    apiFetch<TripDetail>(`/api/v1/trips/${tripId}`).then((result) => {
      if ("data" in result) return setState({ status: "ready", data: result.data });
      if (result.error === "UNAUTHORIZED") return router.replace("/login");
      setState({ status: "error", error: plannerError(result.error) });
    });
  }, [router, tripId]);

  async function reloadTrip() {
    const result = await apiFetch<TripDetail>(basePath);
    if (!("data" in result)) return null;
    setState({ status: "ready", data: result.data });
    return result.data;
  }

  // Après le paiement : true si le pass est maintenant actif.
  async function reloadPass() {
    return (await reloadTrip())?.pass.active ?? false;
  }

  const mutate: Mutate = async (path, method, body) => {
    setError(null);
    const result = await apiFetch<TripDetail>(`${basePath}${path}`, { method, body });
    if ("data" in result) {
      setState({ status: "ready", data: result.data });
      return true;
    }
    if (result.error === "UNAUTHORIZED") router.replace("/login");
    // Limite atteinte sur un voyage sans pass : on propose le pass plutôt qu'un simple message d'erreur.
    const upsell = upsellFor(result.error);
    if (upsell) setPassFeature(upsell);
    else setError(plannerError(result.error));
    return false;
  };

  function upsellFor(code: string): TripPassFeature | null {
    if (state.status !== "ready" || state.data.pass.active) return null;
    if (code === "DAILY_LIMIT_REACHED") return "ai";
    if (code === "CHAT_LIMIT_REACHED") return "chat";
    return null;
  }

  async function regenerate() {
    if (!window.confirm(t("trip.regenerateConfirm"))) return;
    setRegenerating(true);
    await mutate("/regenerate", "POST");
    setRegenerating(false);
  }

  // Une réimagination remplace tout le planning : on confirme avant de revenir en arrière.
  async function undo(kind: TripPlanChangeKind) {
    if (kind === "regenerate" && !window.confirm(t("undo.confirmRegenerate"))) return;
    setUndoing(true);
    const ok = await mutate("/undo", "POST");
    // Refusée (délai passé, planning modifié depuis) : le voyage relu ne propose plus d'annuler.
    if (!ok) await reloadTrip();
    setChatVersion((version) => version + 1);
    setUndoing(false);
  }

  async function handleDelete() {
    if (!window.confirm(t("trip.deleteConfirm"))) return;
    setError(null);
    const result = await apiFetch(basePath, { method: "DELETE" });
    if ("data" in result || result.error === "NOT_FOUND") return router.push("/planner");
    setError(plannerError(result.error));
  }

  if (state.status === "loading") return <PlannerSkeleton />;
  if (state.status === "error") {
    return (
      <div className="flex flex-col items-start gap-4">
        <FormError>{t(state.error === "NOT_FOUND" ? "trip.notFound" : "trip.loadError")}</FormError>
        <Link href="/planner" className="text-label-lg text-accent hover:underline">
          {t("trip.back")}
        </Link>
      </div>
    );
  }

  const { trip, items, tasks, role, pass, chatLimit, mapsUrls, aiQuota, map, undo: lastChange } = state.data;
  // Lecteur : consultation seule (l'API refuse de toute façon les modifications).
  const canEdit = role !== "viewer";

  return (
    <div className="flex flex-col gap-6">
      <TripHeader
        trip={trip}
        items={items}
        role={role}
        passActive={pass.active}
        mutate={mutate}
        onError={setError}
        onLocked={setPassFeature}
        regenerating={regenerating}
        sharing={sharing}
        onToggleSharing={() => setSharing((open) => !open)}
        onRegenerate={regenerate}
        onDelete={handleDelete}
      />

      {!online && (
        <p role="status" className="flex items-center gap-2 rounded-lg bg-ink px-4 py-3 text-body-sm text-surface">
          <Icon name="visibilityOff" className="size-4.5 shrink-0" />
          {t("offline")}
        </p>
      )}

      {sharing && <TripSharePanel tripId={tripId} />}

      {canEdit && lastChange && <UndoBanner change={lastChange} pending={undoing} onUndo={() => void undo(lastChange.kind)} />}

      {error && (
        <div role="alert">
          <FormError>{t(`errors.${error}`)}</FormError>
        </div>
      )}

      <div role="tablist" aria-label={t("views.label")} className="flex gap-1 self-start rounded-lg bg-surface-muted p-1">
        {(["plan", "table", "expenses"] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={view === value}
            onClick={() => setView(value)}
            className={`flex items-center gap-1.5 rounded-lg px-4 py-2 font-display text-label-lg transition focus-visible:ring-2 focus-visible:ring-accent/25 focus-visible:outline-none ${
              view === value ? "bg-surface text-ink shadow-sm" : "text-ink-soft hover:text-ink"
            }`}
          >
            <Icon name={value === "plan" ? "calendar" : value === "table" ? "category" : "book"} className="size-4.5" />
            {t(`views.${value}`)}
          </button>
        ))}
      </div>

      {view === "expenses" ? (
        <TripExpenses tripId={tripId} />
      ) : view === "table" ? (
        <TripTableView
          trip={trip}
          items={items}
          canEdit={canEdit}
          onColor={(item, color) => mutate(`/items/${item.id}`, "PATCH", { color })}
        />
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="flex min-w-0 flex-col gap-6">
            <DayPlanner
              trip={trip}
              items={items}
              mutate={mutate}
              canEdit={canEdit}
              passActive={pass.active}
              mapsUrls={mapsUrls}
              onLocked={setPassFeature}
            />
            {/* Tuiles en ligne uniquement : rien hors connexion. */}
            {online && <TripMap map={map} />}
          </div>
          <aside className="flex flex-col gap-6">
            <TripChat
              basePath={basePath}
              refreshKey={chatVersion}
              trip={trip}
              mutate={mutate}
              canEdit={canEdit}
              chatLimit={chatLimit}
              aiQuota={aiQuota}
              passActive={pass.active}
              onUpsell={setPassFeature}
            />
            {!pass.active && <TripPassCard pass={pass} onOpen={() => setPassFeature("info")} />}
            <TaskChecklist tasks={tasks} mutate={mutate} canEdit={canEdit} />
            <BudgetCard trip={trip} mutate={mutate} canEdit={canEdit} />
          </aside>
        </div>
      )}

      {!pass.active && (
        <TripPassDialog feature={passFeature} onClose={() => setPassFeature(null)} tripId={tripId} pass={pass} role={role} onRefresh={reloadPass} />
      )}
    </div>
  );
}

function TripHeader({
  trip,
  items,
  role,
  passActive,
  mutate,
  onError,
  onLocked,
  regenerating,
  sharing,
  onToggleSharing,
  onRegenerate,
  onDelete,
}: {
  trip: Trip;
  items: TripItem[];
  role: TripRole;
  passActive: boolean;
  mutate: Mutate;
  onError: (error: PlannerError) => void;
  onLocked: (feature: TripPassFeature) => void;
  regenerating: boolean;
  sharing: boolean;
  onToggleSharing: () => void;
  onRegenerate: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations("Planner");
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);

  // ID à donner au support ou à un admin (pass voyage, problème de paiement…).
  async function copyId() {
    try {
      await navigator.clipboard.writeText(trip.id);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  function exportCsv() {
    const days = tripDays(trip.start_date, trip.end_date);
    const csv = buildTripCsv({ trip, items }, days, {
      headers: ["day", "date", "time", "category", "title", "description", "source"].map((key) => t(`export.columns.${key}`)),
      category: (category) => t(`categories.${category as ItemCategory}`),
      dayLabel: (number) => t("days.label", { number }),
    });
    downloadFile(csv.name, csv.content, "text/csv;charset=utf-8");
  }

  const [downloading, setDownloading] = useState<"pdf" | "calendar" | null>(null);
  const [pdfMenu, setPdfMenu] = useState(false);
  const pdfMenuRef = useRef<HTMLDivElement>(null);
  useDismiss(pdfMenuRef, pdfMenu, () => setPdfMenu(false));

  // Pass voyage : fichier généré par le serveur, qui vérifie lui-même le pass.
  async function download(kind: "pdf" | "calendar", template?: TripPdfTemplate) {
    if (!passActive) return onLocked(kind);
    setPdfMenu(false);
    setDownloading(kind);
    const query = template ? `?${new URLSearchParams({ template })}` : "";
    const result = await apiDownload(`/api/v1/trips/${trip.id}/export/${kind}${query}`);
    setDownloading(null);
    if ("error" in result) return onError(plannerError(result.error));
    const [extension, type] = kind === "pdf" ? ["pdf", "application/pdf"] : ["ics", "text/calendar"];
    downloadFile(`${exportFileName(trip.title)}.${extension}`, result.data, type);
  }
  const total = budgetTotal(trip);

  async function handleRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = String(new FormData(event.currentTarget).get("title") ?? "");
    if (await mutate("", "PATCH", { title })) setEditing(false);
  }

  return (
    <Card className="flex flex-col gap-5 p-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
        <div className="flex min-w-0 flex-col gap-1">
          <nav aria-label={t("trip.breadcrumb")} className="font-display text-label-md text-ink-soft uppercase">
            <Link href="/planner" className="hover:text-accent">
              {t("trip.breadcrumb")}
            </Link>
            <span aria-hidden="true"> / </span>
            {flagEmoji(trip.destination_country_code)}{" "}
            {trip.destination_city ?? countryName(trip.destination_country_code, "fr")}
          </nav>

          {editing ? (
            <form onSubmit={handleRename} className="flex flex-wrap items-center gap-2">
              <label htmlFor="trip-title" className="sr-only">
                {t("trip.titleLabel")}
              </label>
              <Input id="trip-title" name="title" defaultValue={trip.title} maxLength={100} required autoFocus className="max-w-md" />
              <Button type="submit" size="sm">
                {t("trip.save")}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setEditing(false)}>
                {t("trip.cancel")}
              </Button>
            </form>
          ) : (
            <h1 className="flex items-center gap-2 font-display text-headline-lg text-ink">
              <span className="min-w-0">{trip.title}</span>
              {role !== "viewer" && (
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  aria-label={t("trip.editTitle")}
                  className="rounded-lg p-1 text-ink-soft transition hover:bg-surface-muted hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/25 focus-visible:outline-none"
                >
                  <Icon name="edit" className="size-4.5" />
                </button>
              )}
            </h1>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={onToggleSharing} aria-expanded={sharing} className="gap-1.5">
            <Icon name="share" className="size-4" />
            {t("share.open")}
          </Button>
          <Button variant="secondary" size="sm" onClick={exportCsv} className="gap-1.5">
            <Icon name="download" className="size-4" />
            {t("export.csv")}
          </Button>
          <div ref={pdfMenuRef} className="relative">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => (passActive ? setPdfMenu((open) => !open) : onLocked("pdf"))}
              disabled={downloading !== null}
              aria-expanded={passActive ? pdfMenu : undefined}
              title={passActive ? undefined : t("pass.locked", { feature: t("export.pdf") })}
              className={`gap-1.5 ${passActive ? "" : LOCKED_BUTTON}`}
            >
              <Icon name={passActive ? "download" : "lock"} className="size-4" />
              {t("export.pdf")}
              {passActive && <Icon name="chevronDown" className="size-4" />}
            </Button>
            {pdfMenu && (
              <ul
                aria-label={t("export.templatesLabel")}
                className="absolute right-0 z-20 mt-1 flex w-72 flex-col rounded-lg border border-line bg-surface p-1 shadow-sm"
              >
                {TRIP_PDF_TEMPLATES.map((template) => (
                  <li key={template}>
                    <button
                      type="button"
                      onClick={() => void download("pdf", template)}
                      className="flex w-full flex-col items-start rounded-lg px-3 py-2 text-left transition hover:bg-surface-muted focus-visible:bg-surface-muted focus-visible:outline-none"
                    >
                      <span className="font-display text-label-lg text-ink">{t(`export.templates.${template}`)}</span>
                      <span className="text-label-sm text-ink-soft">{t(`export.templateHints.${template}`)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void download("calendar")}
            disabled={downloading !== null}
            title={passActive ? undefined : t("pass.locked", { feature: t("export.calendar") })}
            className={`gap-1.5 ${passActive ? "" : LOCKED_BUTTON}`}
          >
            <Icon name={passActive ? "calendar" : "lock"} className="size-4" />
            {t("export.calendar")}
          </Button>
          {role === "owner" && (
            <Button variant="secondary" size="sm" onClick={onDelete} disabled={regenerating} className="gap-1.5">
              <Icon name="delete" className="size-4" />
              {t("trip.delete")}
            </Button>
          )}
          {role !== "viewer" && (
            <Button size="sm" onClick={onRegenerate} disabled={regenerating} className="gap-1.5">
              <Icon name="sparkles" className="size-4" />
              {regenerating ? t("trip.regenerating") : t("trip.regenerate")}
            </Button>
          )}
        </div>
      </div>

      {regenerating && <ReasoningText phrases={t.raw("create.reasoning") as string[]} />}

      <ul className="flex flex-wrap gap-2">
        <Chip icon="calendar">
          {format.dateTimeRange(parseDay(trip.start_date), parseDay(trip.end_date), {
            day: "numeric",
            month: "short",
            year: "numeric",
          })}
        </Chip>
        {trip.destinations.length > 1 && (
          <Chip icon="pin">
            <span className="sr-only">{t("trip.route")} </span>
            {trip.destinations.map((place) => place.city ?? countryName(place.country_code, "fr")).join(" · ")}
          </Chip>
        )}
        <Chip icon="category">{trip.archetype.label}</Chip>
        <Chip icon="group">{t("trip.travelers", { count: trip.traveler_count })}</Chip>
        <Chip icon="book">
          {trip.budget_target === null
            ? t("trip.budgetChip", { total })
            : t("trip.budgetChipTarget", { total, target: trip.budget_target })}
        </Chip>
        {trip.generated_at && (
          <Chip icon="sparkles">
            {t("trip.aiSynced", { when: format.relativeTime(new Date(trip.generated_at), now) })}
          </Chip>
        )}
        <Chip icon="explore">{t("trip.sources", { count: trip.source_post_count })}</Chip>
        {passActive && <Chip icon="sparkles">{t("pass.active")}</Chip>}
        {role !== "owner" && <Chip icon="share">{t(`share.yourRole.${role}`)}</Chip>}
      </ul>

      <p className="flex flex-wrap items-center gap-2 text-label-sm text-ink-soft">
        {t("trip.idLabel")}
        <code className="rounded bg-surface-muted px-1.5 py-0.5 font-mono text-ink select-all">{trip.id}</code>
        <button
          type="button"
          onClick={() => void copyId()}
          className="rounded-lg px-1.5 py-0.5 font-medium text-accent hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-accent/25 focus-visible:outline-none"
        >
          <span aria-live="polite">{copied ? t("trip.idCopied") : t("trip.copyId")}</span>
        </button>
      </p>

      {trip.instructions && (
        <details className="rounded-lg bg-surface-muted p-4 text-body-sm text-ink-soft">
          <summary className="cursor-pointer font-display text-label-lg text-ink">{t("trip.wishesTitle")}</summary>
          <p className="mt-2 whitespace-pre-line">{trip.instructions}</p>
        </details>
      )}

      {trip.season_note && (
        <div className="flex gap-3 rounded-lg bg-surface-muted p-4">
          <Icon name="calendar" className="mt-0.5 size-5 shrink-0 text-accent" />
          <div className="flex flex-col gap-0.5">
            <p className="font-display text-label-lg text-ink">{t("trip.seasonTitle")}</p>
            <p className="text-body-sm text-ink-soft">{trip.season_note}</p>
          </div>
        </div>
      )}
    </Card>
  );
}

function Chip({ icon, children }: { icon: IconName; children: ReactNode }) {
  return (
    <li className="inline-flex items-center gap-1.5 rounded-lg bg-surface-muted px-3 py-1.5 text-body-sm text-ink-soft">
      <Icon name={icon} className="size-4" />
      {children}
    </li>
  );
}

function DayPlanner({
  trip,
  items,
  mutate,
  canEdit,
  passActive,
  mapsUrls,
  onLocked,
}: {
  trip: Trip;
  items: TripItem[];
  mutate: Mutate;
  canEdit: boolean;
  passActive: boolean;
  mapsUrls: Record<string, string> | null;
  onLocked: (feature: TripPassFeature) => void;
}) {
  const t = useTranslations("Planner");
  const format = useFormatter();
  const days = tripDays(trip.start_date, trip.end_date);
  const [selectedDay, setSelectedDay] = useState(days[0]);
  const [adding, setAdding] = useState(false);
  const [regeneratingDay, setRegeneratingDay] = useState(false);
  // Le voyage a pu être régénéré entre-temps.
  const day = days.includes(selectedDay) ? selectedDay : days[0];
  const dayNumber = days.indexOf(day) + 1;
  const dayItems = items.filter((item) => item.day === day);
  const mapsUrl = mapsUrls?.[day];

  async function regenerateDay() {
    if (!passActive) return onLocked("day");
    if (!window.confirm(t("days.regenerateConfirm"))) return;
    setRegeneratingDay(true);
    await mutate(`/days/${day}/regenerate`, "POST");
    setRegeneratingDay(false);
  }

  return (
    <Card className="flex flex-col gap-5 p-6">
      <h2 className="font-display text-headline-sm text-ink">{t("days.title")}</h2>

      <div role="tablist" aria-label={t("days.title")} className="flex gap-2 overflow-x-auto pb-1">
        {days.map((value, index) => {
          const active = value === day;
          return (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => {
                setSelectedDay(value);
                setAdding(false);
              }}
              className={`flex shrink-0 flex-col items-center rounded-lg px-4 py-2 font-display text-label-md transition focus-visible:ring-2 focus-visible:ring-accent/25 focus-visible:outline-none ${
                active ? "bg-ink text-surface" : "bg-surface-muted text-ink-soft hover:text-ink"
              }`}
            >
              <span>{t("days.label", { number: index + 1 })}</span>
              <span className="text-label-sm opacity-80">
                {format.dateTime(parseDay(value), { day: "numeric", month: "short" })}
              </span>
            </button>
          );
        })}
      </div>

      <div role="tabpanel" className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-display text-label-lg text-ink">
            {t("days.heading", {
              number: dayNumber,
              date: format.dateTime(parseDay(day), { weekday: "long", day: "numeric", month: "long" }),
            })}
          </h3>
          <span className="rounded-lg bg-surface-muted px-2.5 py-1 text-label-sm text-ink-soft">
            {t("days.count", { count: dayItems.length })}
          </span>
        </div>

        <div className="flex flex-wrap gap-2">
          {canEdit && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void regenerateDay()}
              disabled={regeneratingDay}
              title={passActive ? undefined : t("pass.locked", { feature: t("days.regenerate") })}
              className={`gap-1.5 ${passActive ? "" : LOCKED_BUTTON}`}
            >
              <Icon name={passActive ? "refresh" : "lock"} className="size-4" />
              {regeneratingDay ? t("days.regenerating") : t("days.regenerate")}
            </Button>
          )}
          {mapsUrl ? (
            <a
              href={mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonClassName("sm", "gap-1.5", "secondary")}
            >
              <Icon name="pin" className="size-4" />
              {t("days.maps")}
            </a>
          ) : (
            !passActive && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => onLocked("maps")}
                title={t("pass.locked", { feature: t("days.maps") })}
                className={`gap-1.5 ${LOCKED_BUTTON}`}
              >
                <Icon name="lock" className="size-4" />
                {t("days.maps")}
              </Button>
            )
          )}
        </div>

        {dayItems.length === 0 && <p className="text-body-sm text-ink-soft">{t("days.empty")}</p>}

        <ol className="flex flex-col gap-3">
          {dayItems.map((item) => (
            <ItemRow key={item.id} item={item} days={days} mutate={mutate} canEdit={canEdit} />
          ))}
        </ol>

        {!canEdit ? null : adding ? (
          <ItemForm
            days={days}
            initial={{ day, start_time: "09:00", title: "", description: null, category: "activity" }}
            onCancel={() => setAdding(false)}
            onSubmit={async (body) => {
              if (await mutate("/items", "POST", body)) setAdding(false);
            }}
          />
        ) : (
          <Button variant="secondary" size="sm" onClick={() => setAdding(true)} className="gap-1.5 self-start">
            <Icon name="add" className="size-4" />
            {t("item.add")}
          </Button>
        )}
      </div>
    </Card>
  );
}

function ItemRow({ item, days, mutate, canEdit }: { item: TripItem; days: string[]; mutate: Mutate; canEdit: boolean }) {
  const t = useTranslations("Planner");
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <li>
        <ItemForm
          days={days}
          initial={item}
          onCancel={() => setEditing(false)}
          onSubmit={async (body) => {
            if (await mutate(`/items/${item.id}`, "PATCH", body)) setEditing(false);
          }}
        />
      </li>
    );
  }

  return (
    <li className="flex gap-3 rounded-lg bg-surface-muted p-4 sm:gap-4">
      <span className="w-11 shrink-0 font-display text-label-lg text-ink sm:w-12">{item.start_time}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex items-center gap-2 font-display text-label-lg text-ink">
          <Icon name={CATEGORY_ICONS[item.category]} className="size-4.5 text-ink-soft" />
          {item.title}
        </span>
        {item.description && <p className="text-body-sm text-ink-soft">{item.description}</p>}
        {item.source_post && (
          <p className="text-body-sm text-ink-soft">
            {t("item.source")}{" "}
            <Link href={`/post/${item.source_post.slug}`} className="font-medium text-accent hover:underline">
              {item.source_post.title}
            </Link>
          </p>
        )}
      </div>
      {/* Empilés sur mobile : plus de place pour le titre. */}
      {canEdit && (
        <div className="-mt-1.5 -mr-1.5 flex shrink-0 flex-col items-start sm:mt-0 sm:mr-0 sm:flex-row sm:gap-1">
          <IconButton icon="edit" label={t("item.edit", { title: item.title })} onClick={() => setEditing(true)} />
          <IconButton
            icon="delete"
            label={t("item.delete", { title: item.title })}
            onClick={() => void mutate(`/items/${item.id}`, "DELETE")}
          />
        </div>
      )}
    </li>
  );
}

type ItemFormValues = Pick<TripItem, "day" | "start_time" | "title" | "description" | "category">;

function ItemForm({
  days,
  initial,
  onSubmit,
  onCancel,
}: {
  days: string[];
  initial: ItemFormValues;
  onSubmit: (body: Record<string, string>) => Promise<void>;
  onCancel: () => void;
}) {
  const t = useTranslations("Planner");
  const format = useFormatter();
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    await onSubmit({
      day: String(form.get("day")),
      startTime: String(form.get("startTime")),
      title: String(form.get("title")),
      description: String(form.get("description") ?? ""),
      category: String(form.get("category")),
    });
    setPending(false);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-lg border border-line p-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field id="item-day" label={t("days.title")}>
          <select id="item-day" name="day" defaultValue={initial.day} className={`h-11 ${FIELD_CLASS_NAME}`}>
            {days.map((value, index) => (
              <option key={value} value={value}>
                {t("days.dayTab", {
                  number: index + 1,
                  date: format.dateTime(parseDay(value), { day: "numeric", month: "short" }),
                })}
              </option>
            ))}
          </select>
        </Field>
        <Field id="item-time" label={t("item.time")}>
          <Input id="item-time" name="startTime" type="time" defaultValue={initial.start_time} required />
        </Field>
        <Field id="item-category" label={t("item.category")}>
          <select id="item-category" name="category" defaultValue={initial.category} className={`h-11 ${FIELD_CLASS_NAME}`}>
            {ITEM_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {t(`categories.${category}`)}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field id="item-title" label={t("item.title")}>
        <Input
          id="item-title"
          name="title"
          defaultValue={initial.title}
          maxLength={120}
          placeholder={t("item.titlePlaceholder")}
          required
        />
      </Field>
      <Field id="item-description" label={t("item.description")}>
        <Textarea
          id="item-description"
          name="description"
          defaultValue={initial.description ?? ""}
          maxLength={500}
          placeholder={t("item.descriptionPlaceholder")}
          className="min-h-20"
        />
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={onCancel}>
          {t("item.cancel")}
        </Button>
        <Button type="submit" size="sm" disabled={pending}>
          {t("item.save")}
        </Button>
      </div>
    </form>
  );
}

function TaskChecklist({ tasks, mutate, canEdit }: { tasks: TripTask[]; mutate: Mutate; canEdit: boolean }) {
  const t = useTranslations("Planner");
  const done = tasks.filter((task) => task.done).length;

  async function handleAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const label = String(new FormData(form).get("label") ?? "");
    if (await mutate("/tasks", "POST", { label })) form.reset();
  }

  return (
    <Card className="flex flex-col gap-4 p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-headline-sm text-ink">{t("tasks.title")}</h2>
        <span className="rounded-lg bg-surface-muted px-2.5 py-1 text-label-sm text-ink-soft">
          {t("tasks.progress", { done, total: tasks.length })}
        </span>
      </div>

      {tasks.length === 0 && <p className="text-body-sm text-ink-soft">{t("tasks.empty")}</p>}

      <ul className="flex flex-col gap-2">
        {tasks.map((task) => (
          <li key={task.id} className="flex items-start gap-2 rounded-lg bg-surface-muted px-3 py-2.5">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <Checkbox
                checked={task.done}
                disabled={!canEdit}
                onChange={(event) => void mutate(`/tasks/${task.id}`, "PATCH", { done: event.currentTarget.checked })}
                className="items-start"
              >
                <span className={task.done ? "text-ink-soft line-through" : "text-ink"}>{task.label}</span>
              </Checkbox>
              {task.detail && <span className="pl-6.5 text-label-sm text-ink-soft">{task.detail}</span>}
            </div>
            {canEdit && (
              <IconButton
                icon="close"
                label={t("tasks.delete", { label: task.label })}
                onClick={() => void mutate(`/tasks/${task.id}`, "DELETE")}
              />
            )}
          </li>
        ))}
      </ul>

      {canEdit && (
        <form onSubmit={handleAdd} className="flex gap-2">
          <label htmlFor="task-label" className="sr-only">
            {t("tasks.addLabel")}
          </label>
          <Input id="task-label" name="label" maxLength={120} placeholder={t("tasks.addPlaceholder")} required />
          <Button type="submit" variant="secondary" className="shrink-0">
            {t("tasks.add")}
          </Button>
        </form>
      )}
    </Card>
  );
}

function BudgetCard({ trip, mutate, canEdit }: { trip: Trip; mutate: Mutate; canEdit: boolean }) {
  const t = useTranslations("Planner");
  const [saved, setSaved] = useState(false);
  const total = budgetTotal(trip);
  const target = trip.budget_target;
  const progress = target ? Math.min(100, Math.round((total / target) * 100)) : 100;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const amount = (name: string) => Math.max(0, Math.round(Number(form.get(name) || 0)));
    const targetValue = String(form.get("budgetTarget") ?? "").trim();

    setSaved(false);
    const ok = await mutate("", "PATCH", {
      ...Object.fromEntries(BUDGET_FIELDS.map(({ body }) => [body, amount(body)])),
      budgetTarget: targetValue === "" ? null : amount("budgetTarget"),
    });
    setSaved(ok);
  }

  return (
    <Card className="flex flex-col gap-4 p-6">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-display text-headline-sm text-ink">{t("budget.title")}</h2>
        <span className="font-display text-label-lg text-ink">
          {target === null ? t("budget.total", { total }) : t("budget.totalWithTarget", { total, target })}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
        <div
          className={`h-full rounded-full ${target !== null && total > target ? "bg-error" : "bg-ink"}`}
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* key : repart des valeurs à jour après une régénération. */}
      <form
        key={`${trip.generated_at}-${total}-${target}`}
        onSubmit={handleSubmit}
        onChange={() => setSaved(false)}
        className="flex flex-col gap-3"
      >
        <fieldset disabled={!canEdit} className="contents">
          <div className="grid grid-cols-2 gap-3">
            {BUDGET_FIELDS.map(({ key, body, label }) => (
              <Field key={key} id={`budget-${label}`} label={t(`budget.${label}`)}>
                <Input id={`budget-${label}`} name={body} type="number" min={0} max={1_000_000} step={1} defaultValue={trip[key]} />
              </Field>
            ))}
          </div>
          <Field id="budget-target" label={t("budget.target")}>
            <Input
              id="budget-target"
              name="budgetTarget"
              type="number"
              min={0}
              max={1_000_000}
              step={1}
              defaultValue={target ?? ""}
              placeholder={t("budget.targetPlaceholder")}
            />
          </Field>
        </fieldset>
        {canEdit && (
          <div className="flex items-center justify-end gap-3">
            {saved && (
              <span role="status" className="text-body-sm text-ink-soft">
                {t("budget.saved")}
              </span>
          )}
          <Button type="submit" variant="secondary" size="sm">
            {t("budget.save")}
          </Button>
        </div>
        )}
      </form>
    </Card>
  );
}

// Une proposition n'est ajoutée au planning que si l'utilisateur répond oui.
function TripChat({
  basePath,
  refreshKey,
  trip,
  mutate,
  canEdit,
  chatLimit,
  aiQuota,
  passActive,
  onUpsell,
}: {
  basePath: string;
  refreshKey: number;
  trip: Trip;
  mutate: Mutate;
  canEdit: boolean;
  chatLimit: number;
  aiQuota: TripDetail["aiQuota"];
  passActive: boolean;
  onUpsell: (feature: TripPassFeature) => void;
}) {
  const t = useTranslations("Planner");
  const me = parseSessionUser(getSessionSnapshot());
  const router = useRouter();
  const [messages, setMessages] = useState<TripMessage[] | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<PlannerError | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [messages, sending]);

  async function send() {
    const content = draft.trim();
    if (content.length < 2 || sending) return;
    if (quotaReached) return passActive ? undefined : onUpsell("ai");

    setSending(true);
    setError(null);
    const result = await apiFetch<{ messages: TripMessage[] }>(`${basePath}/messages`, {
      method: "POST",
      body: { content },
    });
    setSending(false);

    if ("data" in result) {
      setMessages(result.data.messages);
      setDraft("");
      setCounter({ base: aiQuota.used, sent: used - aiQuota.used + 1 });
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
    <Card className="flex flex-col gap-4 p-6">
      <div className="flex flex-col gap-1">
        <h2 className="flex items-center gap-2 font-display text-headline-sm text-ink">
          <Icon name="sparkles" className="size-5 text-accent" />
          {t("chat.title")}
        </h2>
        <p className="text-body-sm text-ink-soft">{t("chat.hint")}</p>
        {/* Combien de fois Biirbou peut encore aider aujourd'hui (rien pour un compte sans limite). */}
        {canEdit && aiQuota.limit !== null && !quotaReached && (
          <p aria-live="polite" className="mt-1 inline-flex items-center gap-1.5 self-start rounded-lg bg-surface-muted px-2.5 py-1 text-label-sm text-ink-soft">
            <Icon name="sparkles" className="size-3.5 text-accent" />
            {t.rich("chat.left", {
              count: Math.max(0, aiQuota.limit - used),
              strong: (chunks) => <strong className="font-semibold text-ink">{chunks}</strong>,
            })}
          </p>
        )}
      </div>

      <div ref={scroller} className="flex max-h-[32rem] flex-col gap-3 overflow-y-auto" aria-live="polite">
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
              id="chat-message"
              value={draft}
              onChange={(event) => setDraft(event.currentTarget.value)}
              onKeyDown={handleKeyDown}
              minLength={2}
              maxLength={CHAT_MESSAGE_MAX}
              rows={1}
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
            <p className="text-label-sm text-ink-soft">
              {t(passActive ? "chat.quotaReachedPass" : "chat.quotaReached")}
            </p>
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
    </Card>
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
      {suggestion.source_post && (
        <p className="text-body-sm text-ink-soft">
          {t("item.source")}{" "}
          <Link href={`/post/${suggestion.source_post.slug}`} className="font-medium text-accent hover:underline">
            {suggestion.source_post.title}
          </Link>
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
          className={`mt-1 flex items-center gap-1.5 text-label-sm ${
            suggestion.status === "accepted" ? "text-accent" : "text-ink-soft"
          }`}
        >
          {suggestion.status === "accepted" && <Icon name="check" className="size-4" />}
          {suggestion.status === "accepted" ? t(`chat.applied.${suggestion.action}`) : t("chat.rejected")}
        </span>
      )}
    </li>
  );
}

// Dernier changement de Biirbou : « Annuler » restaure le planning d'avant (le plus récent d'abord, pendant TRIP_UNDO_HOURS).
function UndoBanner({ change, pending, onUndo }: { change: NonNullable<TripDetail["undo"]>; pending: boolean; onUndo: () => void }) {
  const t = useTranslations("Planner");
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  return (
    <div role="status" className="flex flex-wrap items-center gap-3 rounded-lg bg-surface-muted px-4 py-3">
      <Icon name="sparkles" className="size-4.5 shrink-0 text-accent" />
      <p className="mr-auto text-body-sm text-ink">
        {t(`undo.messages.${change.kind}`, { when: format.relativeTime(new Date(change.created_at), now) })}{" "}
        <span className="text-ink-soft">{t("undo.hint", { hours: TRIP_UNDO_HOURS })}</span>
      </p>
      <Button size="sm" variant="secondary" disabled={pending} onClick={onUndo} className="gap-1.5">
        <Icon name="refresh" className="size-4" />
        {pending ? t("undo.undoing") : t("undo.action")}
      </Button>
    </div>
  );
}

function PlannerSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-hidden="true">
      <Card className="h-40 animate-pulse bg-surface-muted" />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <Card className="h-96 animate-pulse bg-surface-muted" />
        <Card className="h-96 animate-pulse bg-surface-muted" />
      </div>
    </div>
  );
}
