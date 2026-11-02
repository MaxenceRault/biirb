"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore, type FormEvent } from "react";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { ProfileAvatarLink, ProfileNameLink } from "@/components/ProfileLink";
import { RoleBadge } from "@/components/RoleBadge";
import { Avatar } from "@/components/ui/Avatar";
import { Button, buttonClassName } from "@/components/ui/Button";
import { FormError } from "@/components/ui/FormError";
import { Icon } from "@/components/ui/Icon";
import { Textarea } from "@/components/ui/Textarea";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import type { UserRole } from "@/lib/roles";
import { apiFetch, getSessionSnapshot, parseSessionUser, subscribeSession } from "@/client/session";

export type PostComment = {
  id: number;
  parent_id: number | null;
  content: string;
  created_at: string;
  author: {
    id: string;
    username: string;
    display_name: string;
    avatar_url: string | null;
    avatar_seed: string | null;
    avatar_background_color: string | null;
    role: UserRole;
  };
};

const COMMENT_MAX = 1000;
const ERRORS = [
  "INVALID_INPUT",
  "INVALID_PARENT",
  "TOO_MANY_REQUESTS",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONTENT_REJECTED",
  "INTERNAL_ERROR",
] as const;
type CommentErrorCode = (typeof ERRORS)[number];

type User = ReturnType<typeof parseSessionUser>;

// Lecture publique ; écrire demande d'être connecté. Un seul niveau de réponses sous chaque commentaire.
// Supprimer : son propre commentaire, ou tout commentaire pour un admin (les réponses partent avec leur fil).
export function PostComments({ postId, initialComments }: { postId: number; initialComments: PostComment[] }) {
  const t = useTranslations("Comments");
  const confirm = useConfirm();
  const session = useSyncExternalStore(subscribeSession, getSessionSnapshot, () => null);
  const user = parseSessionUser(session);
  const [comments, setComments] = useState(initialComments);
  const [replyingTo, setReplyingTo] = useState<number | null>(null);
  const [error, setError] = useState<CommentErrorCode | null>(null);
  const threads = comments.filter((comment) => comment.parent_id === null);

  async function remove(commentId: number) {
    const confirmed = await confirm({
      title: t("deleteConfirm.title"),
      message: t("deleteConfirm.message"),
      confirmLabel: t("deleteConfirm.action"),
      icon: "delete",
      danger: true,
    });
    if (!confirmed) return;
    setError(null);
    const result = await apiFetch(`/api/v1/posts/${postId}/comments/${commentId}`, { method: "DELETE" });
    if ("data" in result || result.error === "NOT_FOUND") {
      return setComments((current) => current.filter((comment) => comment.id !== commentId && comment.parent_id !== commentId));
    }
    setError(ERRORS.find((code) => code === result.error) ?? "INTERNAL_ERROR");
  }

  function added(comment: PostComment) {
    setComments((current) => [...current, comment]);
    setReplyingTo(null);
  }

  return (
    <section aria-labelledby="comments-title" className="mt-10 flex flex-col gap-5 border-t border-line pt-8">
      <h2 id="comments-title" className="font-display text-headline-sm text-ink">
        {t("title", { count: comments.length })}
      </h2>

      {threads.length === 0 && <p className="text-body-md text-ink-soft">{t("empty")}</p>}
      <FormError>{error && t(`errors.${error}`)}</FormError>

      <ul className="flex flex-col gap-5">
        {threads.map((thread) => {
          const replies = comments.filter((comment) => comment.parent_id === thread.id);
          return (
            <li key={thread.id} className="flex flex-col gap-3">
              <CommentItem
                comment={thread}
                user={user}
                onDelete={remove}
                onReply={user ? () => setReplyingTo(replyingTo === thread.id ? null : thread.id) : undefined}
              />
              {(replies.length > 0 || replyingTo === thread.id) && (
                <ul className="ml-6 flex flex-col gap-3 border-l-2 border-line pl-4 sm:ml-12">
                  {replies.map((reply) => (
                    <li key={reply.id}>
                      <CommentItem comment={reply} user={user} onDelete={remove} small />
                    </li>
                  ))}
                  {replyingTo === thread.id && (
                    <li>
                      <CommentForm
                        postId={postId}
                        parentId={thread.id}
                        onCreated={added}
                        onCancel={() => setReplyingTo(null)}
                        placeholder={t("replyPlaceholder", { name: thread.author.display_name })}
                      />
                    </li>
                  )}
                </ul>
              )}
            </li>
          );
        })}
      </ul>

      {user ? (
        <CommentForm postId={postId} onCreated={added} placeholder={t("placeholder")} />
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface-muted p-4">
          <p className="text-body-md text-ink-soft">{t("loginPrompt")}</p>
          <Link href="/login" className={buttonClassName("sm")}>
            {t("login")}
          </Link>
        </div>
      )}
    </section>
  );
}

function CommentItem({
  comment,
  user,
  onDelete,
  onReply,
  small = false,
}: {
  comment: PostComment;
  user: User;
  onDelete: (id: number) => void;
  onReply?: () => void;
  small?: boolean;
}) {
  const t = useTranslations("Comments");
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const canDelete = user && (user.id === comment.author.id || user.role === "admin");
  // Borné à maintenant : l'horloge du serveur peut avoir quelques secondes d'avance.
  const date = new Date(Math.min(Date.parse(comment.created_at), now.getTime()));

  return (
    <div className="flex gap-3">
      {/* Avatar et nom de l'auteur du commentaire mènent à son profil public. */}
      <ProfileAvatarLink username={comment.author.username} name={comment.author.display_name}>
        <Avatar
          src={comment.author.avatar_url}
          name={comment.author.avatar_seed ?? comment.author.id}
          backgroundColor={comment.author.avatar_background_color}
          alt=""
          size={small ? 32 : 40}
        />
      </ProfileAvatarLink>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-col gap-1 rounded-lg bg-surface-muted px-4 py-3">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-display text-label-lg text-ink">
              <ProfileNameLink username={comment.author.username}>{comment.author.display_name}</ProfileNameLink>
            </span>
            <RoleBadge role={comment.author.role} />
            <span className="text-label-sm text-ink-soft">{format.relativeTime(date, now)}</span>
            {canDelete && (
              <button
                type="button"
                onClick={() => onDelete(comment.id)}
                aria-label={t("delete")}
                className="ml-auto rounded-lg p-1 text-ink-soft transition hover:bg-surface hover:text-error"
              >
                <Icon name="delete" className="size-4" />
              </button>
            )}
          </div>
          {/* Texte brut, jamais interprété comme du HTML. */}
          <p className="text-body-md break-words whitespace-pre-line text-ink">{comment.content}</p>
        </div>
        {onReply && (
          <button
            type="button"
            onClick={onReply}
            className="self-start px-1 font-display text-label-md text-ink-soft transition hover:text-accent"
          >
            {t("reply")}
          </button>
        )}
      </div>
    </div>
  );
}

function CommentForm({
  postId,
  parentId,
  placeholder,
  onCreated,
  onCancel,
}: {
  postId: number;
  parentId?: number;
  placeholder: string;
  onCreated: (comment: PostComment) => void;
  onCancel?: () => void;
}) {
  const t = useTranslations("Comments");
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<CommentErrorCode | null>(null);
  const id = parentId ? `reply-${parentId}` : "comment-content";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSending(true);
    setError(null);
    const result = await apiFetch<{ comment: PostComment }>(`/api/v1/posts/${postId}/comments`, {
      method: "POST",
      body: { content: draft, ...(parentId ? { parentId } : {}) },
    });
    setSending(false);

    if ("data" in result) {
      setDraft("");
      return onCreated(result.data.comment);
    }
    if (result.error === "UNAUTHORIZED") return router.push("/login");
    setError(ERRORS.find((code) => code === result.error) ?? "INTERNAL_ERROR");
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      <label htmlFor={id} className="sr-only">
        {t("label")}
      </label>
      <Textarea
        id={id}
        value={draft}
        onChange={(event) => setDraft(event.currentTarget.value)}
        maxLength={COMMENT_MAX}
        placeholder={placeholder}
        required
        autoFocus={Boolean(parentId)}
        className={parentId ? "min-h-16" : "min-h-24"}
      />
      <FormError>{error && t(`errors.${error}`)}</FormError>
      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button variant="secondary" size="sm" onClick={onCancel}>
            {t("cancel")}
          </Button>
        )}
        <Button type="submit" size={parentId ? "sm" : "md"} disabled={sending || !draft.trim()} className="gap-2">
          <Icon name="send" className="size-4" />
          {sending ? t("sending") : parentId ? t("replySubmit") : t("submit")}
        </Button>
      </div>
    </form>
  );
}
