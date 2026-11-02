"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { AdminKanban } from "@/components/AdminKanban";
import { RoleBadge } from "@/components/RoleBadge";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Checkbox } from "@/components/ui/Checkbox";
import { Field } from "@/components/ui/Field";
import { FormError } from "@/components/ui/FormError";
import { Icon, type IconName } from "@/components/ui/Icon";
import { FIELD_CLASS_NAME, Input } from "@/components/ui/Input";
import { USER_ROLES, type UserRole } from "@/lib/roles";
import { apiFetch, getSessionSnapshot, parseSessionUser, subscribeSession, type ApiResult } from "@/client/session";

type Dashboard = {
  counts: {
    users: number;
    banned_users: number;
    new_users_7d: number;
    posts: number;
    hidden_posts: number;
    new_posts_7d: number;
    trips: number;
    open_reports: number;
  };
  ai: { today: number; perDay: { day: string; total: number }[]; enabled: boolean; dailyCap: number; perUserLimit: number };
  recentUsers: { id: string; username: string; display_name: string; created_at: string }[];
};

type AdminUser = {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  avatar_seed: string | null;
  avatar_background_color: string | null;
  role: UserRole;
  banned_at: string | null;
  created_at: string;
  post_count: number;
};

type AdminPost = {
  id: number;
  title: string;
  slug: string;
  is_hidden: boolean;
  created_at: string;
  archetype: { slug: string; label: string };
  author: { id: string; username: string; display_name: string };
  open_report_count: number;
};

type ReportedPost = {
  post_id: number;
  title: string;
  slug: string;
  is_hidden: boolean;
  author: { id: string; username: string; display_name: string };
  report_count: number;
  last_reported_at: string;
  reasons: { reason: string | null; reporter: string | null; created_at: string }[];
};

type AdminArchetype = {
  id: number;
  slug: string;
  label: string;
  description: string | null;
  is_active: boolean;
  post_count: number;
};

type Settings = { ai_enabled: boolean; ai_daily_cap: number; updated_at: string };

type AdminAction = {
  id: number;
  action: string;
  target_type: string;
  target_id: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
  admin: { id: string; username: string } | null;
};

// Identifiant public d'un voyage (affiché sur sa page) : validé aussi par le serveur.
const UUID_PATTERN = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";

type UnassignedTripPass = {
  id: number;
  amount: string;
  currency: string;
  payer_email_hint: string | null;
  created_at: string;
  payer: { username: string } | null;
};

type ActiveTripPass = { id: number; trip: { id: string; title: string; owner: string }; gift: boolean; assigned_at: string };

type Paged<K extends string, T> = Record<K, T[]> & { total: number; page: number; pageSize: number };

const ADMIN_ERRORS = [
  "FORBIDDEN",
  "NOT_FOUND",
  "INVALID_INPUT",
  "CANNOT_TARGET_SELF",
  "TARGET_IS_ADMIN",
  "ARCHETYPE_TAKEN",
  "BANNED_WORD_TAKEN",
  "TRIP_NOT_FOUND",
  "PASS_ALREADY_ACTIVE",
  "EMAIL_MISMATCH",
  "TOO_MANY_REQUESTS",
  "INTERNAL_ERROR",
] as const;
type AdminErrorCode = (typeof ADMIN_ERRORS)[number];

function adminError(code: string): AdminErrorCode {
  return (ADMIN_ERRORS as readonly string[]).find((known) => known === code) as AdminErrorCode ?? "INTERNAL_ERROR";
}

const TABS = ["dashboard", "reports", "tickets", "posts", "users", "tripPasses", "archetypes", "bannedWords", "ai", "journal"] as const;
type Tab = (typeof TABS)[number];

const TAB_ICONS: Record<Tab, IconName> = {
  dashboard: "category",
  reports: "flag",
  tickets: "help",
  posts: "book",
  users: "settings",
  tripPasses: "lock",
  archetypes: "explore",
  bannedWords: "block",
  ai: "sparkles",
  journal: "clock",
};

const API = "/api/v1/admin";

// Renvoie {} pour une réponse 204, null en cas d'erreur (affichée).
type Call = <T>(path: string, init?: { method?: string; body?: unknown }) => Promise<T | null>;

type Access = "checking" | "denied" | "granted";

export function AdminView() {
  const t = useTranslations("Admin");
  const router = useRouter();
  const [access, setAccess] = useState<Access>("checking");
  const [tab, setTab] = useState<Tab>("dashboard");
  const [error, setError] = useState<AdminErrorCode | null>(null);
  const session = useSyncExternalStore(subscribeSession, getSessionSnapshot, () => null);
  const currentUserId = parseSessionUser(session)?.id ?? null;

  // Interface seulement : l'API revérifie le rôle en base à chaque appel.
  useEffect(() => {
    if (!getSessionSnapshot()) return router.replace("/login");
    apiFetch(`${API}/dashboard`).then((result) => {
      if ("data" in result) return setAccess("granted");
      if (result.error === "UNAUTHORIZED") return router.replace("/login");
      setAccess("denied");
    });
  }, [router]);

  const call: Call = useCallback(
    async <T,>(path: string, init?: { method?: string; body?: unknown }) => {
      setError(null);
      const result: ApiResult<T> = await apiFetch<T>(`${API}${path}`, init);
      if ("data" in result) return result.data ?? ({} as T);
      if (result.error === "UNAUTHORIZED") router.replace("/login");
      setError(adminError(result.error));
      return null;
    },
    [router],
  );

  if (access === "checking") return <Card className="h-96 animate-pulse bg-surface-muted" aria-hidden="true" />;
  if (access === "denied") {
    return (
      <Card className="flex flex-col items-start gap-3 p-6">
        <h1 className="flex items-center gap-2 font-display text-headline-md text-ink">
          <Icon name="block" className="size-6 text-error" />
          {t("denied.title")}
        </h1>
        <p className="text-body-md text-ink-soft">{t("denied.text")}</p>
        <Link href="/" className="font-display text-label-lg text-accent hover:underline">
          {t("denied.back")}
        </Link>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="flex items-center gap-2 font-display text-display-lg-mobile text-ink md:text-headline-xl">
          <Icon name="shield" className="size-8 text-accent" />
          {t("heading")}
        </h1>
        <p className="text-body-md text-ink-soft">{t("subheading")}</p>
      </header>

      <div role="tablist" aria-label={t("heading")} className="flex gap-2 overflow-x-auto border-b border-line pb-3">
        {TABS.map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => {
              setTab(value);
              setError(null);
            }}
            className={`flex shrink-0 items-center gap-1.5 rounded-lg border px-3.5 py-1.5 font-display text-label-md whitespace-nowrap transition focus-visible:ring-2 focus-visible:ring-accent/25 focus-visible:outline-none ${
              tab === value
                ? "border-ink bg-ink text-surface"
                : "border-line bg-surface text-ink-soft hover:border-ink-soft/25 hover:text-ink"
            }`}
          >
            <Icon name={TAB_ICONS[value]} className="size-4" />
            {t(`tabs.${value}`)}
          </button>
        ))}
      </div>

      {error && (
        <div role="alert">
          <FormError>{t(`errors.${error}`)}</FormError>
        </div>
      )}

      <div role="tabpanel">
        {tab === "dashboard" && <DashboardTab call={call} onOpen={setTab} />}
        {tab === "reports" && <ReportsTab call={call} />}
        {tab === "tickets" && <AdminKanban call={call} currentUserId={currentUserId} />}
        {tab === "posts" && <PostsTab call={call} />}
        {tab === "users" && <UsersTab call={call} currentUserId={currentUserId} />}
        {tab === "tripPasses" && <TripPassesTab call={call} />}
        {tab === "archetypes" && <ArchetypesTab call={call} />}
        {tab === "bannedWords" && <BannedWordsTab call={call} />}
        {tab === "ai" && <AiTab call={call} />}
        {tab === "journal" && <JournalTab call={call} />}
      </div>
    </div>
  );
}

function useResource<T>(call: Call, path: string) {
  const [data, setData] = useState<T | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    call<T>(path).then((result) => {
      if (!cancelled && result) setData(result);
    });
    return () => {
      cancelled = true;
    };
  }, [call, path, version]);

  return { data, reload: () => setVersion((value) => value + 1) };
}

function DashboardTab({ call, onOpen }: { call: Call; onOpen: (tab: Tab) => void }) {
  const t = useTranslations("Admin");
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const { data } = useResource<Dashboard>(call, "/dashboard");
  if (!data) return <Skeleton />;

  const { counts, ai } = data;
  const maxDay = Math.max(1, ...ai.perDay.map(({ total }) => total));
  const stats: { label: string; value: number; hint?: string; tab?: Tab; alert?: boolean }[] = [
    { label: t("dashboard.users"), value: counts.users, hint: t("dashboard.new7d", { count: counts.new_users_7d }), tab: "users" },
    { label: t("dashboard.banned"), value: counts.banned_users, tab: "users" },
    { label: t("dashboard.posts"), value: counts.posts, hint: t("dashboard.new7d", { count: counts.new_posts_7d }), tab: "posts" },
    { label: t("dashboard.hidden"), value: counts.hidden_posts, tab: "posts" },
    { label: t("dashboard.reports"), value: counts.open_reports, tab: "reports", alert: counts.open_reports > 0 },
    { label: t("dashboard.trips"), value: counts.trips },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {stats.map((stat) => {
          const content = (
            <>
              <span className="text-label-sm text-ink-soft">{stat.label}</span>
              <span className={`font-display text-headline-md ${stat.alert ? "text-error" : "text-ink"}`}>{stat.value}</span>
              {stat.hint && <span className="text-label-sm text-ink-soft">{stat.hint}</span>}
            </>
          );
          return stat.tab ? (
            <button
              key={stat.label}
              type="button"
              onClick={() => onOpen(stat.tab!)}
              className="flex flex-col items-start gap-1 rounded-lg border border-line bg-surface p-4 text-left transition hover:border-ink-soft/30"
            >
              {content}
            </button>
          ) : (
            <Card key={stat.label} className="flex flex-col gap-1 p-4">
              {content}
            </Card>
          );
        })}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="flex flex-col gap-4 p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="flex items-center gap-2 font-display text-headline-sm text-ink">
              <Icon name="sparkles" className="size-5 text-accent" />
              {t("dashboard.aiTitle")}
            </h2>
            <Badge tone={ai.enabled ? "neutral" : "danger"}>{ai.enabled ? t("ai.on") : t("ai.off")}</Badge>
          </div>
          <p className="text-body-md text-ink">
            {t("dashboard.aiToday", { count: ai.today, cap: ai.dailyCap })}
            <span className="block text-body-sm text-ink-soft">{t("dashboard.aiPerUser", { limit: ai.perUserLimit })}</span>
          </p>
          <ol className="flex h-32 items-end gap-2" aria-label={t("dashboard.aiHistory")}>
            {ai.perDay.map(({ day, total }) => (
              <li key={day} className="flex flex-1 flex-col items-center gap-1">
                <span className="text-label-sm text-ink-soft">{total}</span>
                <span
                  className="w-full rounded-t bg-accent/70"
                  style={{ height: `${Math.max(2, (total / maxDay) * 80)}px` }}
                  aria-hidden="true"
                />
                <span className="text-label-sm text-ink-soft">
                  {format.dateTime(new Date(`${day}T12:00:00`), { weekday: "short" })}
                </span>
              </li>
            ))}
          </ol>
        </Card>

        <Card className="flex flex-col gap-3 p-6">
          <h2 className="font-display text-headline-sm text-ink">{t("dashboard.recentUsers")}</h2>
          <ul className="flex flex-col gap-2">
            {data.recentUsers.map((user) => (
              <li key={user.id} className="flex items-baseline justify-between gap-2 text-body-sm">
                <span className="min-w-0 truncate text-ink">
                  {user.display_name} <span className="text-ink-soft">@{user.username}</span>
                </span>
                <span className="shrink-0 text-ink-soft">{format.relativeTime(new Date(user.created_at), now)}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

function ReportsTab({ call }: { call: Call }) {
  const t = useTranslations("Admin");
  const format = useFormatter();
  const { data, reload } = useResource<{ reports: ReportedPost[] }>(call, "/reports");

  async function act(path: string, method: string, body?: unknown, confirmMessage?: string) {
    if (confirmMessage && !window.confirm(confirmMessage)) return;
    if ((await call(path, { method, body })) !== null) reload();
  }

  if (!data) return <Skeleton />;
  if (data.reports.length === 0) return <Empty>{t("reports.empty")}</Empty>;

  return (
    <ul className="flex flex-col gap-4">
      {data.reports.map((report) => (
        <li key={report.post_id}>
          <Card className="flex flex-col gap-3 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 flex-col gap-1">
                <Link href={`/post/${report.slug}`} className="font-display text-label-lg text-ink hover:text-accent">
                  {report.title}
                </Link>
                <span className="text-body-sm text-ink-soft">
                  {t("byAuthor", { name: report.author.display_name, username: report.author.username })}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="danger">
                  <Icon name="flag" className="size-3.5" />
                  {t("reports.count", { count: report.report_count })}
                </Badge>
                {report.is_hidden && <Badge>{t("posts.hiddenBadge")}</Badge>}
              </div>
            </div>

            <ul className="flex flex-col gap-2">
              {report.reasons.map((reason, index) => (
                <li key={index} className="rounded-lg bg-surface-muted px-3 py-2 text-body-sm">
                  <p className={reason.reason ? "whitespace-pre-line text-ink" : "text-ink-soft italic"}>
                    {reason.reason ?? t("reports.noReason")}
                  </p>
                  <p className="text-label-sm text-ink-soft">
                    {reason.reporter ? `@${reason.reporter}` : t("reports.system")} · {format.dateTime(new Date(reason.created_at), { dateStyle: "medium", timeStyle: "short" })}
                  </p>
                </li>
              ))}
            </ul>

            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => act(`/reports/${report.post_id}`, "PATCH", { status: "dismissed" })}>
                <Icon name="check" className="size-4" />
                {t("reports.dismiss")}
              </Button>
              {report.is_hidden ? (
                <Button variant="secondary" size="sm" onClick={() => act(`/posts/${report.post_id}`, "PATCH", { hidden: false })}>
                  <Icon name="visibility" className="size-4" />
                  {t("posts.approve")}
                </Button>
              ) : (
                <Button variant="secondary" size="sm" onClick={() => act(`/posts/${report.post_id}`, "PATCH", { hidden: true })}>
                  <Icon name="visibilityOff" className="size-4" />
                  {t("posts.hide")}
                </Button>
              )}
              <Button size="sm" onClick={() => act(`/posts/${report.post_id}`, "DELETE", undefined, t("posts.deleteConfirm", { title: report.title }))}>
                <Icon name="delete" className="size-4" />
                {t("posts.delete")}
              </Button>
            </div>
          </Card>
        </li>
      ))}
    </ul>
  );
}

// Achats payés avec un autre email ou sans commande : rattachés après vérification de l'email déclaré par l'acheteur.
function TripPassesTab({ call }: { call: Call }) {
  const t = useTranslations("Admin");
  const format = useFormatter();
  const { data, reload } = useResource<{ unassigned: UnassignedTripPass[]; active: ActiveTripPass[] }>(call, "/trip-passes");
  const [done, setDone] = useState(false);

  async function grant(body: { tripId: string; passId?: number; payerEmail?: string }) {
    setDone(false);
    const result = await call("/trip-passes", { method: "POST", body });
    if (result === null) return false;
    setDone(true);
    reload();
    return true;
  }

  async function handleAssign(event: FormEvent<HTMLFormElement>, passId: number) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const ok = await grant({ passId, tripId: String(values.get("tripId") ?? "").trim(), payerEmail: String(values.get("payerEmail") ?? "") });
    if (ok) form.reset();
  }

  async function handleGift(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const tripId = String(new FormData(form).get("tripId") ?? "").trim();
    if (!window.confirm(t("tripPasses.giftConfirm", { id: tripId }))) return;
    if (await grant({ tripId })) form.reset();
  }

  async function revoke(pass: ActiveTripPass) {
    if (!window.confirm(t("tripPasses.revokeConfirm", { title: pass.trip.title }))) return;
    if ((await call(`/trip-passes/${pass.id}`, { method: "DELETE" })) !== null) reload();
  }

  if (!data) return <Skeleton />;

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex flex-col gap-6">
        <Card className="flex flex-col gap-4 p-6">
          <div className="flex flex-col gap-1">
            <h2 className="font-display text-headline-sm text-ink">{t("tripPasses.unassignedTitle")}</h2>
            <p className="text-body-sm text-ink-soft">{t("tripPasses.unassignedHint")}</p>
          </div>
          {done && (
            <p role="status" className="text-body-sm text-accent">
              {t("tripPasses.done")}
            </p>
          )}
          {data.unassigned.length === 0 ? (
            <p className="text-body-sm text-ink-soft">{t("tripPasses.unassignedEmpty")}</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {data.unassigned.map((pass) => (
                <li key={pass.id} className="flex flex-col gap-3 rounded-lg bg-surface-muted p-4">
                  <p className="text-body-sm text-ink">
                    <span className="font-display text-label-lg">
                      {format.number(Number(pass.amount), { style: "currency", currency: pass.currency })}
                    </span>{" "}
                    · {pass.payer_email_hint ? t("tripPasses.payer", { hint: pass.payer_email_hint }) : t("tripPasses.payerUnknown")}
                    {pass.payer && ` (${t("tripPasses.payerAccount", { username: pass.payer.username })})`} ·{" "}
                    {format.dateTime(new Date(pass.created_at), { dateStyle: "medium", timeStyle: "short" })}
                  </p>
                  <form onSubmit={(event) => void handleAssign(event, pass.id)} className="grid gap-3 sm:grid-cols-[140px_minmax(0,1fr)_auto] sm:items-end">
                    <Field id={`pass-trip-${pass.id}`} label={t("tripPasses.tripId")}>
                      <Input id={`pass-trip-${pass.id}`} name="tripId" pattern={UUID_PATTERN} placeholder={t("tripPasses.tripIdPlaceholder")} spellCheck={false} required />
                    </Field>
                    <Field id={`pass-email-${pass.id}`} label={t("tripPasses.payerEmail")}>
                      <Input id={`pass-email-${pass.id}`} name="payerEmail" type="email" maxLength={254} required />
                    </Field>
                    <Button type="submit" size="sm" className="h-11">
                      {t("tripPasses.assign")}
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="flex flex-col gap-4 p-6">
          <h2 className="font-display text-headline-sm text-ink">{t("tripPasses.activeTitle")}</h2>
          {data.active.length === 0 ? (
            <p className="text-body-sm text-ink-soft">{t("tripPasses.activeEmpty")}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {data.active.map((pass) => (
                <li key={pass.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface-muted px-4 py-3">
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-body-sm text-ink">{t("tripPasses.trip", pass.trip)}</span>
                    <span className="text-label-sm text-ink-soft">
                      {pass.gift ? t("tripPasses.gifted") : t("tripPasses.paid")} ·{" "}
                      {format.dateTime(new Date(pass.assigned_at), { dateStyle: "medium" })}
                    </span>
                  </span>
                  <Button variant="secondary" size="sm" onClick={() => void revoke(pass)}>
                    {t("tripPasses.revoke")}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="flex flex-col gap-4 p-6">
        <div className="flex flex-col gap-1">
          <h2 className="font-display text-headline-sm text-ink">{t("tripPasses.giftTitle")}</h2>
          <p className="text-body-sm text-ink-soft">{t("tripPasses.giftHint")}</p>
        </div>
        <form onSubmit={(event) => void handleGift(event)} className="flex flex-col gap-3">
          <Field id="pass-gift-trip" label={t("tripPasses.tripId")}>
            <Input id="pass-gift-trip" name="tripId" pattern={UUID_PATTERN} placeholder={t("tripPasses.tripIdPlaceholder")} spellCheck={false} required />
          </Field>
          <Button type="submit" className="gap-2">
            <Icon name="sparkles" className="size-4" />
            {t("tripPasses.gift")}
          </Button>
        </form>
      </Card>
    </div>
  );
}

function PostsTab({ call }: { call: Call }) {
  const t = useTranslations("Admin");
  const format = useFormatter();
  const [query, setQuery] = useState({ q: "", visibility: "all", page: 1 });
  const params = new URLSearchParams({ visibility: query.visibility, page: String(query.page), ...(query.q ? { q: query.q } : {}) });
  const { data, reload } = useResource<Paged<"posts", AdminPost>>(call, `/posts?${params}`);

  async function act(path: string, method: string, body?: unknown, confirmMessage?: string) {
    if (confirmMessage && !window.confirm(confirmMessage)) return;
    if ((await call(path, { method, body })) !== null) reload();
  }

  return (
    <div className="flex flex-col gap-4">
      <SearchBar
        placeholder={t("posts.search")}
        onSearch={(q) => setQuery((current) => ({ ...current, q, page: 1 }))}
        filter={
          <select
            aria-label={t("posts.visibility")}
            value={query.visibility}
            onChange={(event) => setQuery((current) => ({ ...current, visibility: event.target.value, page: 1 }))}
            className={`h-11 sm:w-48 ${FIELD_CLASS_NAME}`}
          >
            {(["all", "visible", "hidden"] as const).map((value) => (
              <option key={value} value={value}>
                {t(`posts.filter.${value}`)}
              </option>
            ))}
          </select>
        }
      />

      {!data ? (
        <Skeleton />
      ) : data.posts.length === 0 ? (
        <Empty>{t("posts.empty")}</Empty>
      ) : (
        <ul className="flex flex-col gap-2">
          {data.posts.map((post) => (
            <li key={post.id}>
              <Card className={`flex flex-col gap-3 p-4 sm:flex-row sm:items-center ${post.is_hidden ? "bg-surface-muted" : ""}`}>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/post/${post.slug}`} className="min-w-0 truncate font-display text-label-lg text-ink hover:text-accent">
                      {post.title}
                    </Link>
                    {post.is_hidden && <Badge>{t("posts.hiddenBadge")}</Badge>}
                    {post.open_report_count > 0 && (
                      <Badge tone="danger">{t("reports.count", { count: post.open_report_count })}</Badge>
                    )}
                  </div>
                  <span className="text-body-sm text-ink-soft">
                    {t("byAuthor", { name: post.author.display_name, username: post.author.username })} · {post.archetype.label} ·{" "}
                    {format.dateTime(new Date(post.created_at), { dateStyle: "medium" })}
                  </span>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button variant="secondary" size="sm" onClick={() => act(`/posts/${post.id}`, "PATCH", { hidden: !post.is_hidden })}>
                    <Icon name={post.is_hidden ? "visibility" : "visibilityOff"} className="size-4" />
                    {post.is_hidden ? t("posts.show") : t("posts.hide")}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => act(`/posts/${post.id}`, "DELETE", undefined, t("posts.deleteConfirm", { title: post.title }))}
                    aria-label={t("posts.deleteLabel", { title: post.title })}
                  >
                    <Icon name="delete" className="size-4" />
                  </Button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {data && <Pagination total={data.total} page={data.page} pageSize={data.pageSize} onPage={(page) => setQuery((current) => ({ ...current, page }))} />}
    </div>
  );
}

function UsersTab({ call, currentUserId }: { call: Call; currentUserId: string | null }) {
  const t = useTranslations("Admin");
  const tRoles = useTranslations("Roles");
  const format = useFormatter();
  const [query, setQuery] = useState({ q: "", page: 1 });
  const params = new URLSearchParams({ page: String(query.page), ...(query.q ? { q: query.q } : {}) });
  const { data, reload } = useResource<Paged<"users", AdminUser>>(call, `/users?${params}`);

  async function act(path: string, method: string, body?: unknown, confirmMessage?: string) {
    if (confirmMessage && !window.confirm(confirmMessage)) return;
    if ((await call(path, { method, body })) !== null) reload();
  }

  return (
    <div className="flex flex-col gap-4">
      <SearchBar placeholder={t("users.search")} onSearch={(q) => setQuery({ q, page: 1 })} />

      {!data ? (
        <Skeleton />
      ) : data.users.length === 0 ? (
        <Empty>{t("users.empty")}</Empty>
      ) : (
        <ul className="flex flex-col gap-2">
          {data.users.map((user) => {
            const self = user.id === currentUserId;
            const isAdmin = user.role === "admin";
            return (
              <li key={user.id}>
                <Card className={`flex flex-col gap-3 p-4 md:flex-row md:items-center ${user.banned_at ? "bg-surface-muted" : ""}`}>
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <Avatar src={user.avatar_url} name={user.avatar_seed ?? user.id} backgroundColor={user.avatar_background_color} alt="" size={40} />
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-display text-label-lg text-ink">{user.display_name}</span>
                        <RoleBadge role={user.role} showDefault />
                        {user.banned_at && (
                          <Badge tone="danger">
                            <Icon name="block" className="size-3.5" />
                            {t("users.bannedBadge")}
                          </Badge>
                        )}
                        {self && <Badge>{t("users.you")}</Badge>}
                      </div>
                      <span className="text-body-sm text-ink-soft">
                        @{user.username} · {t("users.posts", { count: user.post_count })} ·{" "}
                        {t("users.joined", { date: format.dateTime(new Date(user.created_at), { dateStyle: "medium" }) })}
                      </span>
                    </div>
                  </div>

                  {/* Son propre compte : l'API le refuse aussi. */}
                  {!self && (
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      <label htmlFor={`role-${user.id}`} className="sr-only">
                        {t("users.roleLabel", { name: user.display_name })}
                      </label>
                      <div className="w-44">
                        <select
                          id={`role-${user.id}`}
                          value={user.role}
                          onChange={(event) => {
                            const role = event.target.value as UserRole;
                            const message = role === "admin" ? t("users.promoteConfirm", { name: user.display_name }) : undefined;
                            void act(`/users/${user.id}`, "PATCH", { role }, message);
                          }}
                          className={`h-9 ${FIELD_CLASS_NAME}`}
                        >
                          {USER_ROLES.map((role) => (
                            <option key={role} value={role}>
                              {tRoles(role)}
                            </option>
                          ))}
                        </select>
                      </div>
                      {/* Un admin doit d'abord perdre son rôle pour être banni ou supprimé. */}
                      {!isAdmin && (
                        <>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() =>
                              act(
                                `/users/${user.id}`,
                                "PATCH",
                                { banned: !user.banned_at },
                                user.banned_at ? undefined : t("users.banConfirm", { name: user.display_name }),
                              )
                            }
                          >
                            <Icon name="block" className="size-4" />
                            {user.banned_at ? t("users.unban") : t("users.ban")}
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => act(`/users/${user.id}`, "DELETE", undefined, t("users.deleteConfirm", { name: user.display_name }))}
                            aria-label={t("users.deleteLabel", { name: user.display_name })}
                          >
                            <Icon name="delete" className="size-4" />
                          </Button>
                        </>
                      )}
                    </div>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {data && <Pagination total={data.total} page={data.page} pageSize={data.pageSize} onPage={(page) => setQuery((current) => ({ ...current, page }))} />}
    </div>
  );
}

function ArchetypesTab({ call }: { call: Call }) {
  const t = useTranslations("Admin");
  const { data, reload } = useResource<{ archetypes: AdminArchetype[] }>(call, "/archetypes");

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const created = await call("/archetypes", {
      method: "POST",
      body: { label: String(values.get("label") ?? ""), description: String(values.get("description") ?? "") },
    });
    if (created !== null) {
      form.reset();
      reload();
    }
  }

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
      <Card className="flex flex-col gap-4 p-6">
        <div className="flex flex-col gap-1">
          <h2 className="font-display text-headline-sm text-ink">{t("archetypes.createTitle")}</h2>
          <p className="text-body-sm text-ink-soft">{t("archetypes.createHint")}</p>
        </div>
        <form onSubmit={handleCreate} className="flex flex-col gap-3">
          <Field id="archetype-label" label={t("archetypes.label")}>
            <Input id="archetype-label" name="label" maxLength={40} placeholder={t("archetypes.labelPlaceholder")} required />
          </Field>
          <Field id="archetype-description" label={t("archetypes.description")}>
            <Input id="archetype-description" name="description" maxLength={200} placeholder={t("archetypes.descriptionPlaceholder")} />
          </Field>
          <Button type="submit" className="gap-2">
            <Icon name="add" className="size-4" />
            {t("archetypes.create")}
          </Button>
        </form>
      </Card>

      {!data ? (
        <Skeleton />
      ) : (
        <ul className="flex flex-col gap-2">
          {data.archetypes.map((archetype) => (
            <ArchetypeRow key={`${archetype.id}-${archetype.label}-${archetype.description}`} archetype={archetype} call={call} onSaved={reload} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ArchetypeRow({ archetype, call, onSaved }: { archetype: AdminArchetype; call: Call; onSaved: () => void }) {
  const t = useTranslations("Admin");
  const [editing, setEditing] = useState(false);

  async function save(body: Record<string, unknown>) {
    if ((await call(`/archetypes/${archetype.id}`, { method: "PATCH", body })) !== null) {
      setEditing(false);
      onSaved();
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    await save({ label: String(values.get("label") ?? ""), description: String(values.get("description") ?? "") });
  }

  return (
    <li>
      <Card className={`flex flex-col gap-3 p-4 ${archetype.is_active ? "" : "bg-surface-muted"}`}>
        {editing ? (
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id={`label-${archetype.id}`} label={t("archetypes.label")}>
                <Input id={`label-${archetype.id}`} name="label" defaultValue={archetype.label} maxLength={40} required />
              </Field>
              <Field id={`description-${archetype.id}`} label={t("archetypes.description")}>
                <Input id={`description-${archetype.id}`} name="description" defaultValue={archetype.description ?? ""} maxLength={200} />
              </Field>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setEditing(false)}>
                {t("cancel")}
              </Button>
              <Button type="submit" size="sm">
                {t("save")}
              </Button>
            </div>
          </form>
        ) : (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-display text-label-lg text-ink">{archetype.label}</span>
                {!archetype.is_active && <Badge>{t("archetypes.inactive")}</Badge>}
              </div>
              {archetype.description && <p className="text-body-sm text-ink-soft">{archetype.description}</p>}
              <span className="text-label-sm text-ink-soft">
                {archetype.slug} · {t("users.posts", { count: archetype.post_count })}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <Checkbox checked={archetype.is_active} onChange={(event) => void save({ isActive: event.currentTarget.checked })}>
                {t("archetypes.active")}
              </Checkbox>
              <Button variant="secondary" size="sm" onClick={() => setEditing(true)} aria-label={t("archetypes.edit", { label: archetype.label })}>
                <Icon name="edit" className="size-4" />
              </Button>
            </div>
          </div>
        )}
      </Card>
    </li>
  );
}

// Alignés sur moderationFilter (serveur uniquement).
const BANNED_REASONS = ["insult", "hate", "sexual", "politics"] as const;
const BANNED_KINDS = ["word", "prefix", "phrase"] as const;

type BannedWord = { id: number; term: string; reason: (typeof BANNED_REASONS)[number]; kind: (typeof BANNED_KINDS)[number] };

function BannedWordsTab({ call }: { call: Call }) {
  const t = useTranslations("Admin");
  const { data, reload } = useResource<{ words: BannedWord[] }>(call, "/banned-words");
  const [filter, setFilter] = useState("");
  // Masquée par défaut : la liste ne s'affiche qu'à la demande.
  const [revealed, setRevealed] = useState(false);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const created = await call("/banned-words", {
      method: "POST",
      body: { term: String(values.get("term") ?? ""), reason: values.get("reason"), kind: values.get("kind") },
    });
    if (created !== null) {
      form.reset();
      reload();
    }
  }

  async function remove(word: BannedWord) {
    if (!window.confirm(t("bannedWords.deleteConfirm", { term: word.term }))) return;
    if ((await call(`/banned-words/${word.id}`, { method: "DELETE" })) !== null) reload();
  }

  const words = (data?.words ?? []).filter((word) => word.term.includes(filter.trim().toLowerCase()));

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
      <Card className="flex flex-col gap-4 p-6">
        <div className="flex flex-col gap-1">
          <h2 className="font-display text-headline-sm text-ink">{t("bannedWords.createTitle")}</h2>
          <p className="text-body-sm text-ink-soft">{t("bannedWords.createHint")}</p>
        </div>
        <form onSubmit={handleCreate} className="flex flex-col gap-3">
          <Field id="banned-term" label={t("bannedWords.term")}>
            <Input id="banned-term" name="term" minLength={2} maxLength={60} required />
          </Field>
          <Field id="banned-reason" label={t("bannedWords.reason")}>
            <select id="banned-reason" name="reason" className={`h-11 ${FIELD_CLASS_NAME}`}>
              {BANNED_REASONS.map((reason) => (
                <option key={reason} value={reason}>
                  {t(`bannedWords.reasons.${reason}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field id="banned-kind" label={t("bannedWords.kind")}>
            <select id="banned-kind" name="kind" className={`h-11 ${FIELD_CLASS_NAME}`}>
              {BANNED_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {t(`bannedWords.kinds.${kind}`)}
                </option>
              ))}
            </select>
          </Field>
          <Button type="submit" className="gap-2">
            <Icon name="add" className="size-4" />
            {t("bannedWords.create")}
          </Button>
        </form>
      </Card>

      <Card className="flex flex-col gap-4 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-body-sm text-ink-soft">{t("bannedWords.count", { count: data?.words.length ?? 0 })}</p>
          <Button variant="secondary" size="sm" onClick={() => setRevealed((value) => !value)} aria-pressed={revealed}>
            <Icon name={revealed ? "visibilityOff" : "visibility"} className="size-4" />
            {revealed ? t("bannedWords.hide") : t("bannedWords.show")}
          </Button>
        </div>
        {revealed &&
          (!data ? (
            <Skeleton />
          ) : (
            <>
              <Input
                type="search"
                value={filter}
                onChange={(event) => setFilter(event.currentTarget.value)}
                placeholder={t("bannedWords.search")}
                aria-label={t("bannedWords.search")}
              />
              <ul className="flex flex-wrap gap-2">
                {words.map((word) => (
                  <li key={word.id}>
                    <span className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface-muted py-1 pr-1 pl-3 text-body-sm text-ink">
                      {word.term}
                      <Badge tone={word.reason === "hate" || word.reason === "insult" ? "danger" : "neutral"}>
                        {t(`bannedWords.reasons.${word.reason}`)}
                        {word.kind !== "word" && ` · ${t(`bannedWords.kinds.${word.kind}`)}`}
                      </Badge>
                      <button
                        type="button"
                        onClick={() => void remove(word)}
                        aria-label={t("bannedWords.delete", { term: word.term })}
                        className="rounded-lg p-1 text-ink-soft transition hover:bg-surface hover:text-error"
                      >
                        <Icon name="close" className="size-3.5" />
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ))}
      </Card>
    </div>
  );
}

function AiTab({ call }: { call: Call }) {
  const t = useTranslations("Admin");
  const format = useFormatter();
  const { data, reload } = useResource<{ settings: Settings }>(call, "/settings");
  const [saved, setSaved] = useState(false);

  async function update(body: Record<string, unknown>) {
    setSaved(false);
    if ((await call("/settings", { method: "PATCH", body })) !== null) {
      setSaved(true);
      reload();
    }
  }

  async function handleCap(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await update({ aiDailyCap: Math.round(Number(new FormData(event.currentTarget).get("cap"))) });
  }

  if (!data) return <Skeleton />;
  const { settings } = data;

  return (
    <Card className="flex max-w-2xl flex-col gap-6 p-6">
      <div className="flex flex-col gap-1">
        <h2 className="flex items-center gap-2 font-display text-headline-sm text-ink">
          <Icon name="sparkles" className="size-5 text-accent" />
          {t("ai.title")}
        </h2>
        <p className="text-body-sm text-ink-soft">{t("ai.hint")}</p>
      </div>

      <div className="flex flex-col gap-2 rounded-lg bg-surface-muted p-4">
        <Checkbox checked={settings.ai_enabled} onChange={(event) => void update({ aiEnabled: event.currentTarget.checked })}>
          <span className="font-display text-label-lg text-ink">{t("ai.enabled")}</span>
        </Checkbox>
        <p className="text-body-sm text-ink-soft">{t("ai.enabledHint")}</p>
      </div>

      <form key={settings.ai_daily_cap} onSubmit={handleCap} onChange={() => setSaved(false)} className="flex flex-col gap-3">
        <Field id="ai-cap" label={t("ai.cap")}>
          <Input id="ai-cap" name="cap" type="number" min={0} max={100_000} step={1} defaultValue={settings.ai_daily_cap} required className="max-w-48" />
        </Field>
        <p className="text-body-sm text-ink-soft">{t("ai.capHint")}</p>
        <div className="flex items-center gap-3">
          <Button type="submit" variant="secondary" size="sm">
            {t("save")}
          </Button>
          {saved && (
            <span role="status" className="text-body-sm text-ink-soft">
              {t("ai.saved")}
            </span>
          )}
        </div>
      </form>

      <p className="text-label-sm text-ink-soft">
        {t("ai.updatedAt", { date: format.dateTime(new Date(settings.updated_at), { dateStyle: "medium", timeStyle: "short" }) })}
      </p>
    </Card>
  );
}

function JournalTab({ call }: { call: Call }) {
  const t = useTranslations("Admin");
  const format = useFormatter();
  const { data } = useResource<{ actions: AdminAction[] }>(call, "/actions");

  if (!data) return <Skeleton />;
  if (data.actions.length === 0) return <Empty>{t("journal.empty")}</Empty>;

  return (
    <Card className="overflow-x-auto">
      <table className="w-full text-left text-body-sm">
        <thead className="border-b border-line text-label-sm text-ink-soft">
          <tr>
            <th scope="col" className="px-4 py-3 font-medium">{t("journal.date")}</th>
            <th scope="col" className="px-4 py-3 font-medium">{t("journal.admin")}</th>
            <th scope="col" className="px-4 py-3 font-medium">{t("journal.action")}</th>
            <th scope="col" className="px-4 py-3 font-medium">{t("journal.target")}</th>
          </tr>
        </thead>
        <tbody>
          {data.actions.map((action) => (
            <tr key={action.id} className="border-b border-line last:border-0">
              <td className="px-4 py-2.5 whitespace-nowrap text-ink-soft">
                {format.dateTime(new Date(action.created_at), { dateStyle: "short", timeStyle: "short" })}
              </td>
              <td className="px-4 py-2.5 text-ink">{action.admin ? `@${action.admin.username}` : t("journal.deletedAdmin")}</td>
              <td className="px-4 py-2.5 text-ink">
                {/* « user.role » → « user_role » : un point serait un sous-niveau pour next-intl. */}
                {t.has(`journal.actions.${action.action.replace(".", "_")}`)
                  ? t(`journal.actions.${action.action.replace(".", "_")}`)
                  : action.action}
                {action.details && (
                  <span className="block text-label-sm text-ink-soft">{describeDetails(action.details)}</span>
                )}
              </td>
              <td className="px-4 py-2.5 text-ink-soft">
                {t(`journal.targets.${action.target_type}`)}
                {action.target_id && <span className="block font-mono text-label-sm">{action.target_id}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function describeDetails(details: Record<string, unknown>) {
  return Object.entries(details)
    .map(([key, value]) => `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`)
    .join(" · ");
}

function SearchBar({ placeholder, onSearch, filter }: { placeholder: string; onSearch: (q: string) => void; filter?: ReactNode }) {
  const t = useTranslations("Admin");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSearch(String(new FormData(event.currentTarget).get("q") ?? "").trim());
  }

  return (
    <form role="search" onSubmit={handleSubmit} className="flex flex-col gap-2 sm:flex-row">
      <label htmlFor="admin-search" className="sr-only">
        {placeholder}
      </label>
      <Input id="admin-search" name="q" type="search" maxLength={60} placeholder={placeholder} />
      {filter}
      <Button type="submit" variant="secondary" className="shrink-0 gap-2">
        <Icon name="search" className="size-4" />
        {t("searchSubmit")}
      </Button>
    </form>
  );
}

function Pagination({ total, page, pageSize, onPage }: { total: number; page: number; pageSize: number; onPage: (page: number) => void }) {
  const t = useTranslations("Admin");
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages === 1) return <p className="text-body-sm text-ink-soft">{t("results", { count: total })}</p>;

  return (
    <nav aria-label={t("pagination")} className="flex items-center justify-between gap-3">
      <p className="text-body-sm text-ink-soft">{t("results", { count: total })}</p>
      <div className="flex items-center gap-2">
        <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          {t("previous")}
        </Button>
        <span className="text-body-sm text-ink-soft">{t("page", { page, pages })}</span>
        <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          {t("next")}
        </Button>
      </div>
    </nav>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <Card className="p-6 text-body-md text-ink-soft">{children}</Card>;
}

function Skeleton() {
  return <Card className="h-64 animate-pulse bg-surface-muted" aria-hidden="true" />;
}
