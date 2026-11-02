"use client";

import { useCallback, useEffect, useState, type DragEvent, type FormEvent, type ReactNode } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { BOARD_COLUMNS, DEV_TICKET_DESCRIPTION_MAX, DEV_TICKET_TITLE_MAX, DEV_TICKET_TITLE_MIN, type BoardColumn } from "@/schemas/dev-ticket.schema";
import { TICKET_PRIORITIES, type TicketCategory, type TicketPriority, type TicketStatus } from "@/schemas/ticket.schema";

// Appel de l'API d'administration (AdminView) : null en cas d'erreur, déjà affichée.
type Call = <T>(path: string, init?: { method?: string; body?: unknown }) => Promise<T | null>;

type SupportTicket = {
  id: number;
  subject: string;
  message: string;
  status: TicketStatus;
  priority: TicketPriority;
  category: TicketCategory;
  created_at: string;
  author: { username: string; display_name: string };
};

type DevTicket = {
  id: number;
  title: string;
  description: string | null;
  status: BoardColumn;
  priority: TicketPriority;
  created_at: string;
  author: { username: string; display_name: string } | null;
};

// Tickets de support rangés dans les colonnes du Kanban (l'état est aussi celui que voit l'utilisateur).
const SUPPORT_COLUMN: Record<TicketStatus, BoardColumn> = { open: "todo", in_progress: "in_progress", resolved: "done", closed: "closed" };
const SUPPORT_STATUS: Record<BoardColumn, TicketStatus> = { todo: "open", in_progress: "in_progress", done: "resolved", closed: "closed" };

const BOARDS = ["support", "dev"] as const;
type Board = (typeof BOARDS)[number];

export function AdminKanban({ call }: { call: Call }) {
  const t = useTranslations("Admin.kanban");
  const [board, setBoard] = useState<Board>("support");

  return (
    <div className="flex flex-col gap-4">
      <div role="group" aria-label={t("switchLabel")} className="flex gap-1 self-start rounded-lg bg-surface-muted p-1">
        {BOARDS.map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={board === value}
            onClick={() => setBoard(value)}
            className={`flex items-center gap-1.5 rounded-lg px-4 py-2 font-display text-label-lg transition focus-visible:ring-2 focus-visible:ring-accent/25 focus-visible:outline-none ${
              board === value ? "bg-surface text-ink shadow-sm" : "text-ink-soft hover:text-ink"
            }`}
          >
            <Icon name={value === "support" ? "help" : "settings"} className="size-4.5" />
            {t(`boards.${value}`)}
          </button>
        ))}
      </div>
      <p className="text-body-sm text-ink-soft">{t(`hints.${board}`)}</p>
      {board === "support" ? <SupportBoard call={call} /> : <DevBoard call={call} />}
    </div>
  );
}

function useBoard<T extends { id: number }>(call: Call, path: string) {
  const [tickets, setTickets] = useState<T[] | null>(null);
  const reload = useCallback(() => {
    call<{ tickets: T[] }>(path).then((result) => {
      if (result) setTickets(result.tickets);
    });
  }, [call, path]);
  useEffect(reload, [reload]);
  return { tickets, setTickets, reload };
}

function SupportBoard({ call }: { call: Call }) {
  const t = useTranslations("Admin");
  const format = useFormatter();
  const { tickets, setTickets, reload } = useBoard<SupportTicket>(call, "/tickets/board");

  // Affiché tout de suite, rechargé si l'API refuse.
  async function move(id: number, column: BoardColumn) {
    const status = SUPPORT_STATUS[column];
    setTickets((current) => current?.map((ticket) => (ticket.id === id ? { ...ticket, status } : ticket)) ?? null);
    if ((await call(`/tickets/${id}`, { method: "PATCH", body: { status } })) === null) reload();
  }

  async function prioritize(id: number, priority: TicketPriority) {
    setTickets((current) => sortByPriority(current?.map((ticket) => (ticket.id === id ? { ...ticket, priority } : ticket)) ?? []));
    if ((await call(`/tickets/${id}`, { method: "PATCH", body: { priority } })) === null) reload();
  }

  if (!tickets) return <Card className="h-96 animate-pulse bg-surface-muted" aria-hidden="true" />;

  return (
    <KanbanColumns
      items={tickets.map((ticket) => ({ id: ticket.id, column: SUPPORT_COLUMN[ticket.status] }))}
      onMove={move}
      renderCard={(id) => {
        const ticket = tickets.find((item) => item.id === id)!;
        return (
          <>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-display text-label-sm text-ink-soft">#{ticket.id}</span>
              <Badge tone={ticket.category === "trip_pass" ? "accent" : "neutral"}>{t(`tickets.categories.${ticket.category}`)}</Badge>
            </div>
            <p className="font-display text-label-lg text-ink">{ticket.subject}</p>
            <ExpandableText text={ticket.message} />
            <p className="text-label-sm text-ink-soft">
              {t("byAuthor", { name: ticket.author.display_name, username: ticket.author.username })} ·{" "}
              {format.dateTime(new Date(ticket.created_at), { dateStyle: "short" })}
            </p>
            <PriorityPicker value={ticket.priority} onChange={(priority) => void prioritize(ticket.id, priority)} name={`support-${ticket.id}`} />
          </>
        );
      }}
      cardLabel={(id) => tickets.find((item) => item.id === id)!.subject}
    />
  );
}

function DevBoard({ call }: { call: Call }) {
  const t = useTranslations("Admin.kanban");
  const format = useFormatter();
  const { tickets, setTickets, reload } = useBoard<DevTicket>(call, "/dev-tickets");
  const [editing, setEditing] = useState<number | null>(null);

  async function move(id: number, status: BoardColumn) {
    setTickets((current) => current?.map((ticket) => (ticket.id === id ? { ...ticket, status } : ticket)) ?? null);
    if ((await call(`/dev-tickets/${id}`, { method: "PATCH", body: { status } })) === null) reload();
  }

  async function prioritize(id: number, priority: TicketPriority) {
    setTickets((current) => sortByPriority(current?.map((ticket) => (ticket.id === id ? { ...ticket, priority } : ticket)) ?? []));
    if ((await call(`/dev-tickets/${id}`, { method: "PATCH", body: { priority } })) === null) reload();
  }

  async function create(values: TicketFormValues) {
    if ((await call("/dev-tickets", { method: "POST", body: values })) === null) return false;
    reload();
    return true;
  }

  async function save(id: number, values: TicketFormValues) {
    if ((await call(`/dev-tickets/${id}`, { method: "PATCH", body: values })) === null) return false;
    setEditing(null);
    reload();
    return true;
  }

  async function remove(ticket: DevTicket) {
    if (!window.confirm(t("deleteConfirm", { title: ticket.title }))) return;
    if ((await call(`/dev-tickets/${ticket.id}`, { method: "DELETE" })) !== null) reload();
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-3 p-5">
        <h2 className="font-display text-headline-sm text-ink">{t("newTitle")}</h2>
        <DevTicketForm idPrefix="dev-new" submitLabel={t("add")} onSubmit={create} resetOnSuccess />
      </Card>

      {!tickets ? (
        <Card className="h-96 animate-pulse bg-surface-muted" aria-hidden="true" />
      ) : (
        <KanbanColumns
          items={tickets.map((ticket) => ({ id: ticket.id, column: ticket.status }))}
          onMove={move}
          cardLabel={(id) => tickets.find((item) => item.id === id)!.title}
          renderCard={(id) => {
            const ticket = tickets.find((item) => item.id === id)!;
            if (editing === ticket.id) {
              return (
                <DevTicketForm
                  idPrefix={`dev-${ticket.id}`}
                  initial={ticket}
                  submitLabel={t("save")}
                  onSubmit={(values) => save(ticket.id, values)}
                  onCancel={() => setEditing(null)}
                />
              );
            }
            return (
              <>
                <p className="font-display text-label-lg text-ink">{ticket.title}</p>
                {ticket.description && <ExpandableText text={ticket.description} />}
                <p className="text-label-sm text-ink-soft">
                  {ticket.author ? `@${ticket.author.username}` : t("deletedAuthor")} ·{" "}
                  {format.dateTime(new Date(ticket.created_at), { dateStyle: "short" })}
                </p>
                <PriorityPicker value={ticket.priority} onChange={(priority) => void prioritize(ticket.id, priority)} name={`dev-${ticket.id}`} />
                <div className="flex gap-1">
                  <Button size="sm" variant="secondary" onClick={() => setEditing(ticket.id)} className="gap-1">
                    <Icon name="edit" className="size-3.5" />
                    {t("edit")}
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => void remove(ticket)} className="gap-1">
                    <Icon name="delete" className="size-3.5" />
                    {t("delete")}
                  </Button>
                </div>
              </>
            );
          }}
        />
      )}
    </div>
  );
}

type TicketFormValues = { title: string; description: string; priority: TicketPriority };

function DevTicketForm({
  idPrefix,
  initial,
  submitLabel,
  onSubmit,
  onCancel,
  resetOnSuccess,
}: {
  idPrefix: string;
  initial?: DevTicket;
  submitLabel: string;
  onSubmit: (values: TicketFormValues) => Promise<boolean>;
  onCancel?: () => void;
  resetOnSuccess?: boolean;
}) {
  const t = useTranslations("Admin.kanban");
  const [pending, setPending] = useState(false);
  const [priority, setPriority] = useState<TicketPriority>(initial?.priority ?? "medium");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    setPending(true);
    const ok = await onSubmit({
      title: String(values.get("title") ?? "").trim(),
      description: String(values.get("description") ?? "").trim(),
      priority,
    });
    setPending(false);
    if (ok && resetOnSuccess) {
      form.reset();
      setPriority("medium");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor={`${idPrefix}-title`} className="sr-only">
          {t("titleLabel")}
        </label>
        <Input
          id={`${idPrefix}-title`}
          name="title"
          defaultValue={initial?.title}
          placeholder={t("titlePlaceholder")}
          minLength={DEV_TICKET_TITLE_MIN}
          maxLength={DEV_TICKET_TITLE_MAX}
          required
          className="flex-1"
        />
      </div>
      <PriorityPicker value={priority} onChange={setPriority} name={`${idPrefix}-priority`} />
      <label htmlFor={`${idPrefix}-description`} className="sr-only">
        {t("descriptionLabel")}
      </label>
      <Textarea
        id={`${idPrefix}-description`}
        name="description"
        defaultValue={initial?.description ?? ""}
        placeholder={t("descriptionPlaceholder")}
        maxLength={DEV_TICKET_DESCRIPTION_MAX}
        className="min-h-20"
      />
      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button size="sm" variant="secondary" onClick={onCancel}>
            {t("cancel")}
          </Button>
        )}
        <Button type="submit" size="sm" disabled={pending}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

// Colonnes du Kanban : glisser-déposer à la souris, et menu « Déplacer vers » sur chaque carte (clavier, écran tactile).
function KanbanColumns({
  items,
  onMove,
  renderCard,
  cardLabel,
}: {
  items: { id: number; column: BoardColumn }[];
  onMove: (id: number, column: BoardColumn) => void;
  renderCard: (id: number) => ReactNode;
  cardLabel: (id: number) => string;
}) {
  const t = useTranslations("Admin.kanban");
  const [dragged, setDragged] = useState<number | null>(null);
  const [over, setOver] = useState<BoardColumn | null>(null);

  function drop(event: DragEvent<HTMLElement>, column: BoardColumn) {
    event.preventDefault();
    const id = Number(event.dataTransfer.getData("text/plain"));
    setOver(null);
    setDragged(null);
    if (items.some((item) => item.id === id && item.column !== column)) onMove(id, column);
  }

  return (
    <div className="-mx-1 flex gap-4 overflow-x-auto px-1 pb-2 lg:grid lg:grid-cols-4 lg:overflow-visible">
      {BOARD_COLUMNS.map((column) => {
        const cards = items.filter((item) => item.column === column);
        return (
          <section
            key={column}
            aria-labelledby={`kanban-${column}`}
            onDragOver={(event) => {
              event.preventDefault();
              setOver(column);
            }}
            onDragLeave={() => setOver((current) => (current === column ? null : current))}
            onDrop={(event) => drop(event, column)}
            className={`flex w-72 shrink-0 flex-col gap-3 rounded-lg p-3 transition lg:w-auto ${
              over === column ? "bg-accent/10 ring-2 ring-accent/40" : "bg-surface-muted"
            }`}
          >
            <h3 id={`kanban-${column}`} className="flex items-center justify-between font-display text-label-lg text-ink">
              {t(`columns.${column}`)}
              <span className="rounded-full bg-surface px-2 py-0.5 text-label-sm text-ink-soft">{cards.length}</span>
            </h3>
            {cards.length === 0 && <p className="py-6 text-center text-body-sm text-ink-soft">{t("emptyColumn")}</p>}
            <ul className="flex flex-col gap-2">
              {cards.map(({ id }) => (
                <li
                  key={id}
                  // Clavier : la carte sélectionnée change de colonne avec ← et →.
                  tabIndex={0}
                  aria-label={t("cardLabel", { title: cardLabel(id), column: t(`columns.${column}`) })}
                  aria-keyshortcuts="ArrowLeft ArrowRight"
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget) return;
                    const index = BOARD_COLUMNS.indexOf(column);
                    const target = event.key === "ArrowLeft" ? BOARD_COLUMNS[index - 1] : event.key === "ArrowRight" ? BOARD_COLUMNS[index + 1] : undefined;
                    if (!target) return;
                    event.preventDefault();
                    onMove(id, target);
                  }}
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.setData("text/plain", String(id));
                    event.dataTransfer.effectAllowed = "move";
                    setDragged(id);
                  }}
                  onDragEnd={() => {
                    setDragged(null);
                    setOver(null);
                  }}
                  className={`cursor-grab rounded-lg focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none active:cursor-grabbing ${dragged === id ? "opacity-50" : ""}`}
                >
                  <Card className="flex flex-col gap-2 p-3 shadow-xs">{renderCard(id)}</Card>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

const PRIORITY_RANK: Record<TicketPriority, number> = { high: 0, medium: 1, low: 2 };

// Même ordre que le serveur dans une colonne : priorité haute d'abord.
function sortByPriority<T extends { priority: TicketPriority }>(tickets: T[]) {
  return [...tickets].sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]);
}

const PRIORITY_TONES: Record<TicketPriority, string> = {
  low: "border-line bg-surface-muted text-ink",
  medium: "border-accent/40 bg-accent/10 text-accent",
  high: "border-error/40 bg-error/10 text-error",
};

// Niveaux de priorité en un clic (boutons radio).
function PriorityPicker({ value, onChange, name }: { value: TicketPriority; onChange: (priority: TicketPriority) => void; name: string }) {
  const t = useTranslations("Admin.kanban");
  return (
    <div role="radiogroup" aria-label={t("priorityLabel")} className="flex gap-1">
      {TICKET_PRIORITIES.map((priority) => (
        <label
          key={priority}
          className={`flex-1 cursor-pointer rounded-full border px-2 py-0.5 text-center font-display text-label-sm transition has-focus-visible:ring-2 has-focus-visible:ring-accent/40 ${
            value === priority ? PRIORITY_TONES[priority] : "border-transparent text-ink-soft hover:bg-surface-muted"
          }`}
        >
          <input
            type="radio"
            name={name}
            value={priority}
            checked={value === priority}
            onChange={() => onChange(priority)}
            className="sr-only"
          />
          {t(`priorities.${priority}`)}
        </label>
      ))}
    </div>
  );
}

// Texte long d'une carte : 3 lignes, puis « Voir plus ».
function ExpandableText({ text }: { text: string }) {
  const t = useTranslations("Admin.kanban");
  const [open, setOpen] = useState(false);
  const long = text.length > 160;
  return (
    <div className="flex flex-col items-start gap-1">
      <p className={`text-body-sm whitespace-pre-line text-ink-soft ${open || !long ? "" : "line-clamp-3"}`}>{text}</p>
      {long && (
        <button type="button" onClick={() => setOpen((value) => !value)} className="text-label-sm font-medium text-accent hover:underline">
          {open ? t("less") : t("more")}
        </button>
      )}
    </div>
  );
}
