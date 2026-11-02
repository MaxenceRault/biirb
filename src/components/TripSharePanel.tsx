"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FormError } from "@/components/ui/FormError";
import { Icon } from "@/components/ui/Icon";
import { FIELD_CLASS_NAME, Input } from "@/components/ui/Input";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { apiFetch, getSessionSnapshot, parseSessionUser } from "@/client/session";

const MEMBER_ROLES = ["editor", "viewer"] as const;
type MemberRole = (typeof MEMBER_ROLES)[number];
export type TripRole = "owner" | MemberRole;

type Member = {
  user_id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  avatar_seed: string | null;
  avatar_background_color: string | null;
  role: TripRole;
};

type Invitation = {
  id: number;
  role: MemberRole;
  invitee: { username: string; display_name: string } | null;
  expires_at: string;
};

type Sharing = { role: TripRole; members: Member[]; invitations: Invitation[] };

const SHARE_ERRORS = ["INVALID_INPUT", "USER_NOT_FOUND", "ALREADY_MEMBER", "TRIP_FULL", "TOO_MANY_REQUESTS", "FORBIDDEN", "NOT_FOUND", "INTERNAL_ERROR"] as const;
type ShareError = (typeof SHARE_ERRORS)[number];

// Membres et invitations d'un voyage. Seul le propriétaire invite, change les rôles et retire des membres.
export function TripSharePanel({ tripId }: { tripId: string }) {
  const t = useTranslations("Planner.share");
  const confirm = useConfirm();
  const format = useFormatter();
  const router = useRouter();
  const me = parseSessionUser(getSessionSnapshot());
  const basePath = `/api/v1/trips/${tripId}`;
  const [sharing, setSharing] = useState<Sharing | null>(null);
  const [error, setError] = useState<ShareError | null>(null);
  const [link, setLink] = useState<{ url: string; role: MemberRole } | null>(null);
  const [copied, setCopied] = useState(false);

  const fail = useCallback(
    (code: string) => {
      if (code === "UNAUTHORIZED") return router.replace("/login");
      setError(SHARE_ERRORS.find((known) => known === code) ?? "INTERNAL_ERROR");
    },
    [router],
  );

  useEffect(() => {
    apiFetch<Sharing>(`${basePath}/members`).then((result) => ("data" in result ? setSharing(result.data) : fail(result.error)));
  }, [basePath, fail]);

  async function update(path: string, method: string, body?: unknown) {
    setError(null);
    const result = await apiFetch<Sharing>(`${basePath}${path}`, { method, body });
    if ("data" in result) return setSharing(result.data);
    fail(result.error);
  }

  async function handleInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    setError(null);
    const result = await apiFetch<Sharing>(`${basePath}/members`, {
      method: "POST",
      body: { username: String(values.get("username") ?? ""), role: values.get("role") },
    });
    if (!("data" in result)) return fail(result.error);
    setSharing(result.data);
    form.reset();
  }

  async function createLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const role = new FormData(event.currentTarget).get("role") as MemberRole;
    setError(null);
    setCopied(false);
    const result = await apiFetch<{ code: string; role: MemberRole }>(`${basePath}/invitations`, { method: "POST", body: { role } });
    if (!("data" in result)) return fail(result.error);
    // Code après # : jamais envoyé au serveur ni écrit dans les logs d'accès.
    const refreshed = await apiFetch<Sharing>(`${basePath}/members`);
    if ("data" in refreshed) setSharing(refreshed.data);
    setLink({ url: `${window.location.origin}/planner/join#${result.data.code}`, role: result.data.role });
  }

  async function copyLink() {
    if (!link) return;
    await navigator.clipboard.writeText(link.url).catch(() => null);
    setCopied(true);
  }

  async function remove(member: Member) {
    const leaving = member.user_id === me?.id;
    const confirmed = await confirm(
      leaving
        ? {
          title: t("leaveConfirm.title"),
          message: t("leaveConfirm.message"),
          confirmLabel: t("leaveConfirm.action"),
          icon: "logout",
          danger: true,
        }
        : {
          title: t("removeConfirm.title", { name: member.display_name }),
          message: t("removeConfirm.message"),
          confirmLabel: t("removeConfirm.action"),
          icon: "group",
          danger: true,
        },
    );
    if (!confirmed) return;
    setError(null);
    const result = await apiFetch(`${basePath}/members/${member.user_id}`, { method: "DELETE" });
    if (!("data" in result)) return fail(result.error);
    if (leaving) return router.push("/planner");
    setSharing((current) => current && { ...current, members: current.members.filter((item) => item.user_id !== member.user_id) });
  }

  if (!sharing) {
    return error ? <FormError>{t(`errors.${error}`)}</FormError> : <Card className="h-40 animate-pulse bg-surface-muted" />;
  }

  const isOwner = sharing.role === "owner";

  return (
    <Card className="flex flex-col gap-5 p-6">
      <div className="flex flex-col gap-1">
        <h2 className="flex items-center gap-2 font-display text-headline-sm text-ink">
          <Icon name="share" className="size-5 text-accent" />
          {t("title")}
        </h2>
        <p className="text-body-sm text-ink-soft">{t(isOwner ? "hintOwner" : "hintMember")}</p>
      </div>

      <ul className="flex flex-col gap-2" aria-label={t("membersLabel")}>
        {sharing.members.map((member) => (
          <li key={member.user_id} className="flex items-center gap-3 rounded-lg bg-surface-muted px-3 py-2">
            <Avatar
              src={member.avatar_url}
              name={member.avatar_seed ?? member.user_id}
              backgroundColor={member.avatar_background_color}
              alt=""
              size={32}
            />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate font-display text-label-lg text-ink">
                {member.display_name}
                {member.user_id === me?.id && <span className="text-ink-soft"> {t("you")}</span>}
              </span>
              <span className="truncate text-label-sm text-ink-soft">@{member.username}</span>
            </span>
            {isOwner && member.role !== "owner" ? (
              <select
                aria-label={t("roleLabel", { name: member.display_name })}
                value={member.role}
                onChange={(event) => void update(`/members/${member.user_id}`, "PATCH", { role: event.currentTarget.value })}
                className={`h-9 w-auto ${FIELD_CLASS_NAME}`}
              >
                {MEMBER_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {t(`roles.${role}`)}
                  </option>
                ))}
              </select>
            ) : (
              <Badge tone={member.role === "owner" ? "accent" : "neutral"}>{t(`roles.${member.role}`)}</Badge>
            )}
            {member.role !== "owner" && (isOwner || member.user_id === me?.id) && (
              <button
                type="button"
                onClick={() => void remove(member)}
                aria-label={member.user_id === me?.id ? t("leave") : t("remove", { name: member.display_name })}
                title={member.user_id === me?.id ? t("leave") : t("remove", { name: member.display_name })}
                className="rounded-lg p-1.5 text-ink-soft transition hover:bg-surface hover:text-error focus-visible:ring-2 focus-visible:ring-accent/25 focus-visible:outline-none"
              >
                <Icon name={member.user_id === me?.id ? "logout" : "close"} className="size-4" />
              </button>
            )}
          </li>
        ))}
      </ul>

      {isOwner && (
        <>
          <form onSubmit={handleInvite} className="flex flex-col gap-2">
            <label htmlFor="share-username" className="font-display text-label-lg text-ink">
              {t("inviteTitle")}
            </label>
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
              <Input
                id="share-username"
                name="username"
                required
                minLength={3}
                maxLength={30}
                placeholder={t("usernamePlaceholder")}
                autoComplete="off"
              />
              <RoleSelect id="share-invite-role" label={t("inviteRole")} />
              <Button type="submit" variant="secondary">
                {t("invite")}
              </Button>
            </div>
          </form>

          <form onSubmit={createLink} className="flex flex-col gap-2">
            <span className="font-display text-label-lg text-ink">{t("linkTitle")}</span>
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
              <RoleSelect id="share-link-role" label={t("linkRole")} />
              <Button type="submit" variant="secondary" className="gap-1.5">
                <Icon name="add" className="size-4" />
                {t("createLink")}
              </Button>
            </div>
            {link && (
              <div className="flex flex-col gap-2 rounded-lg border border-line p-3">
                <div className="flex gap-2">
                  <Input readOnly value={link.url} aria-label={t("linkLabel")} onFocus={(event) => event.currentTarget.select()} />
                  <Button type="button" onClick={() => void copyLink()} className="shrink-0">
                    {copied ? t("copied") : t("copy")}
                  </Button>
                </div>
                <p className="text-label-sm text-ink-soft">{t("linkHint", { role: link.role })}</p>
              </div>
            )}
          </form>

          {sharing.invitations.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="font-display text-label-lg text-ink">{t("pendingTitle")}</span>
              <ul className="flex flex-col gap-2">
                {sharing.invitations.map((invitation) => (
                  <li key={invitation.id} className="flex items-center gap-3 rounded-lg border border-line px-3 py-2">
                    <Icon name={invitation.invitee ? "send" : "share"} className="size-4 shrink-0 text-ink-soft" />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-body-sm text-ink">
                        {invitation.invitee ? `@${invitation.invitee.username}` : t("linkInvitation")} · {t(`roles.${invitation.role}`)}
                      </span>
                      <span className="text-label-sm text-ink-soft">
                        {t("expires", { date: format.dateTime(new Date(invitation.expires_at), { day: "numeric", month: "short" }) })}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => void update(`/invitations/${invitation.id}`, "DELETE")}
                      aria-label={t("revoke")}
                      title={t("revoke")}
                      className="rounded-lg p-1.5 text-ink-soft transition hover:bg-surface-muted hover:text-error focus-visible:ring-2 focus-visible:ring-accent/25 focus-visible:outline-none"
                    >
                      <Icon name="close" className="size-4" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      <FormError>{error && t(`errors.${error}`)}</FormError>
    </Card>
  );
}

function RoleSelect({ id, label }: { id: string; label: string }) {
  const t = useTranslations("Planner.share");
  return (
    <>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <select id={id} name="role" defaultValue="editor" className={`h-11 ${FIELD_CLASS_NAME}`}>
        {MEMBER_ROLES.map((role) => (
          <option key={role} value={role}>
            {t(`roles.${role}`)}
          </option>
        ))}
      </select>
    </>
  );
}
