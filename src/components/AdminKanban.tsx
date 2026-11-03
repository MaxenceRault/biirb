"use client";

import { useCallback, useEffect, useRef, useState, type DragEvent, type FormEvent, type ReactNode } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { useDismiss } from "@/client/hooks/useDismiss";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Checkbox } from "@/components/ui/Checkbox";
import { Dialog } from "@/components/ui/Dialog";
import { FilterBar, FilterChip } from "@/components/ui/FilterChip";
import { Icon } from "@/components/ui/Icon";
import { FIELD_CLASS_NAME, Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { BOARD_COLUMNS, DEV_TICKET_DESCRIPTION_MAX, DEV_TICKET_TITLE_MAX, DEV_TICKET_TITLE_MIN, type BoardColumn } from "@/schemas/dev-ticket.schema";
import {
  TICKET_MAX_ASSIGNEES,
  TICKET_PRIORITIES,
  type TicketCategory,
  type TicketPriority,
  type TicketStatus,
} from "@/schemas/ticket.schema";

// Appel de l'API d'administration (AdminView) : null en cas d'erreur, déjà affichée.
type Call = <T>(path: string, init?: { method?: string; body?: unknown }) => Promise<T | null>;

// Admin assignable à un ticket (GET /admin/assignees) : jamais d'email.
type Assignee = {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  avatar_seed: string | null;
  avatar_background_color: string | null;
};

type SupportTicket = {
  id: number;
  subject: string;
  message: string;
  status: TicketStatus;
  priority: TicketPriority;
  category: TicketCategory;
  created_at: string;
  author: { username: string; display_name: string };
  assignees: Assignee[];
};

type DevTicket = {
  id: number;
  title: string;
  description: string | null;
  status: BoardColumn;
  priority: TicketPriority;
  created_at: string;
  author: { username: string; display_name: string } | null;
  assignees: Assignee[];
};

// Tickets de support rangés dans les colonnes du Kanban (l'état est aussi celui que voit l'utilisateur).
const SUPPORT_COLUMN: Record<TicketStatus, BoardColumn> = { open: "todo", in_progress: "in_progress", resolved: "done", closed: "closed" };
const SUPPORT_STATUS: Record<BoardColumn, TicketStatus> = { todo: "open", in_progress: "in_progress", done: "resolved", closed: "closed" };

const BOARDS = ["support", "dev"] as const;
type Board = (typeof BOARDS)[number];

// Filtre des cartes, commun aux deux tableaux. « mine » : l'admin connecté est assigné ; « people » : un des admins choisis.
const FILTERS = ["all", "mine", "unassigned"] as const;
type Filter = (typeof FILTERS)[number] | "people";

// currentUserId : profil de la session (affichage seulement, les droits sont vérifiés par l'API).
export function AdminKanban({ call, currentUserId }: { call: Call; currentUserId: string | null }) {
  const t = useTranslations("Admin.kanban");
  const [board, setBoard] = useState<Board>("support");
  const [filter, setFilter] = useState<Filter>("all");
  const [people, setPeople] = useState<string[]>([]);

  function chooseFilter(value: Filter) {
    setFilter(value);
    setPeople([]);
  }

  // Plusieurs personnes à la fois ; plus personne de choisi : retour à « Tous ».
  function togglePerson(id: string) {
    const next = people.includes(id) ? people.filter((value) => value !== id) : [...people, id];
    setPeople(next);
    setFilter(next.length > 0 ? "people" : "all");
  }
  // Chargés une fois pour les deux tableaux ; null : sélecteur masqué (erreur déjà affichée).
  const [admins, setAdmins] = useState<Assignee[] | null>(null);
  useEffect(() => {
    call<{ admins: Assignee[] }>("/assignees").then((result) => {
      if (result) setAdmins(result.admins);
    });
  }, [call]);

  return (
    <div className="flex flex-col gap-4">
      <Segmented label={t("switchLabel")} options={BOARDS} value={board} onChange={setBoard}>
        {(value) => (
          <>
            <Icon name={value === "support" ? "help" : "settings"} className="size-4.5" />
            {t(`boards.${value}`)}
          </>
        )}
      </Segmented>
      <FilterBar label={t("filterLabel")} className="border-b border-line pb-3">
        {/* « Les miens » : profil de session requis. */}
        {FILTERS.filter((value) => value !== "mine" || currentUserId).map((value) => (
          <FilterChip key={value} active={filter === value} onClick={() => chooseFilter(value)}>
            {t(`filters.${value}`)}
          </FilterChip>
        ))}
        {admins && admins.length > 0 && <span aria-hidden="true" className="mx-1 h-6 w-px shrink-0 bg-line" />}
        {admins?.map((admin) => (
          <FilterChip key={admin.id} active={people.includes(admin.id)} onClick={() => togglePerson(admin.id)} className="pl-1.5">
            <Avatar src={admin.avatar_url} name={admin.avatar_seed ?? admin.id} backgroundColor={admin.avatar_background_color} alt="" size={20} />
            {admin.id === currentUserId ? t("me", { name: admin.display_name }) : admin.display_name}
          </FilterChip>
        ))}
      </FilterBar>
      <p className="text-body-sm text-ink-soft">{t(`hints.${board}`)}</p>
      {board === "support" ? (
        <SupportBoard call={call} admins={admins} visible={(ticket) => matchesFilter(ticket, filter, currentUserId, people)} />
      ) : (
        <DevBoard call={call} admins={admins} visible={(ticket) => matchesFilter(ticket, filter, currentUserId, people)} />
      )}
    </div>
  );
}

function matchesFilter(ticket: { assignees: Assignee[] }, filter: Filter, currentUserId: string | null, people: string[]) {
  if (filter === "mine") return ticket.assignees.some((assignee) => assignee.id === currentUserId);
  if (filter === "unassigned") return ticket.assignees.length === 0;
  if (filter === "people") return ticket.assignees.some((assignee) => people.includes(assignee.id));
  return true;
}

// Boutons à bascule, un seul actif : choix du tableau (Support / Développement).
function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  children,
}: {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  children: (value: T) => ReactNode;
}) {
  return (
    <div role="group" aria-label={label} className="flex gap-1 self-start rounded-lg bg-surface-muted p-1">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={value === option}
          onClick={() => onChange(option)}
          className={`flex items-center gap-1.5 rounded-lg px-4 py-2 font-display text-label-lg transition focus-visible:ring-2 focus-visible:ring-accent/25 focus-visible:outline-none ${
            value === option ? "bg-surface text-ink shadow-sm" : "text-ink-soft hover:text-ink"
          }`}
        >
          {children(option)}
        </button>
      ))}
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

type BoardProps = { call: Call; admins: Assignee[] | null; visible: (ticket: { assignees: Assignee[] }) => boolean };

// Nouvelle liste d'assignés affichée tout de suite : ceux déjà là gardent leur place, les ajoutés viennent de la liste des admins.
function withAssignees<T extends { id: number; assignees: Assignee[] }>(tickets: T[] | null, id: number, ids: string[], admins: Assignee[] | null) {
  return (
    tickets?.map((ticket) => {
      if (ticket.id !== id) return ticket;
      const known = [...ticket.assignees, ...(admins ?? [])];
      return { ...ticket, assignees: ids.map((value) => known.find((admin) => admin.id === value)).filter((admin) => admin !== undefined) };
    }) ?? null
  );
}

function SupportBoard({ call, admins, visible }: BoardProps) {
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

  async function assign(id: number, assigneeIds: string[]) {
    setTickets((current) => withAssignees(current, id, assigneeIds, admins));
    if ((await call(`/tickets/${id}`, { method: "PATCH", body: { assigneeIds } })) === null) reload();
  }

  if (!tickets) return <Card className="h-96 animate-pulse bg-surface-muted" aria-hidden="true" />;

  return (
    <KanbanColumns
      items={tickets.filter(visible).map((ticket) => ({ id: ticket.id, column: SUPPORT_COLUMN[ticket.status] }))}
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
            <AssigneePicker assignees={ticket.assignees} admins={admins} onChange={(ids) => void assign(ticket.id, ids)} />
          </>
        );
      }}
      cardLabel={(id) => tickets.find((item) => item.id === id)!.subject}
      summary={(id) => {
        const ticket = tickets.find((item) => item.id === id)!;
        return {
          title: ticket.subject,
          text: `${ticket.message} ${ticket.author.username} ${ticket.author.display_name}`,
          priority: ticket.priority,
          created_at: ticket.created_at,
          author: `@${ticket.author.username}`,
        };
      }}
    />
  );
}

function DevBoard({ call, admins, visible }: BoardProps) {
  const t = useTranslations("Admin.kanban");
  const confirm = useConfirm();
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

  async function assign(id: number, assigneeIds: string[]) {
    setTickets((current) => withAssignees(current, id, assigneeIds, admins));
    if ((await call(`/dev-tickets/${id}`, { method: "PATCH", body: { assigneeIds } })) === null) reload();
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
    const confirmed = await confirm({
      title: t("deleteConfirm.title", { title: ticket.title }),
      message: t("deleteConfirm.message"),
      confirmLabel: t("deleteConfirm.action"),
      icon: "delete",
      danger: true,
    });
    if (!confirmed) return;
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
          items={tickets.filter(visible).map((ticket) => ({ id: ticket.id, column: ticket.status }))}
          onMove={move}
          cardLabel={(id) => tickets.find((item) => item.id === id)!.title}
          summary={(id) => {
            const ticket = tickets.find((item) => item.id === id)!;
            return {
              title: ticket.title,
              text: `${ticket.description ?? ""} ${ticket.author?.username ?? ""}`,
              priority: ticket.priority,
              created_at: ticket.created_at,
              author: ticket.author ? `@${ticket.author.username}` : t("deletedAuthor"),
            };
          }}
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
                <AssigneePicker assignees={ticket.assignees} admins={admins} onChange={(ids) => void assign(ticket.id, ids)} />
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
  summary,
}: {
  items: { id: number; column: BoardColumn }[];
  onMove: (id: number, column: BoardColumn) => void;
  renderCard: (id: number) => ReactNode;
  cardLabel: (id: number) => string;
  // Ce que la fenêtre d'une colonne affiche et cherche.
  summary: (id: number) => TicketSummary;
}) {
  const t = useTranslations("Admin.kanban");
  const [dragged, setDragged] = useState<number | null>(null);
  const [over, setOver] = useState<BoardColumn | null>(null);
  const [opened, setOpened] = useState<BoardColumn | null>(null);

  // Ticket choisi dans la fenêtre : la carte est amenée à l'écran et sélectionnée (flèches ← → pour la déplacer).
  function reveal(id: number) {
    setOpened(null);
    requestAnimationFrame(() => {
      const card = document.getElementById(`kanban-card-${id}`);
      card?.scrollIntoView({ block: "center", behavior: "smooth" });
      card?.focus({ preventScroll: true });
    });
  }

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
            className={`flex w-80 shrink-0 flex-col gap-3 rounded-lg p-3 transition lg:w-auto ${
              over === column ? "bg-accent/10 ring-2 ring-accent/40" : "bg-surface-muted"
            }`}
          >
            <h3 id={`kanban-${column}`} className="font-display text-label-lg text-ink">
              <button
                type="button"
                onClick={() => setOpened(column)}
                title={t("columnOpen", { column: t(`columns.${column}`) })}
                className="-mx-1 flex w-[calc(100%+0.5rem)] items-center justify-between gap-2 rounded-lg px-1 py-0.5 text-left transition hover:bg-surface focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none"
              >
                <span className="flex items-center gap-1.5">
                  {t(`columns.${column}`)}
                  <Icon name="search" className="size-3.5 text-ink-soft" />
                </span>
                <span className="rounded-full bg-surface px-2 py-0.5 text-label-sm text-ink-soft">{cards.length}</span>
              </button>
            </h3>
            {cards.length === 0 && <p className="py-6 text-center text-body-sm text-ink-soft">{t("emptyColumn")}</p>}
            {/* Défile dans la colonne plutôt que d'allonger la page ; le dépôt reste possible sur toute la colonne.
                relative : les champs sr-only (position absolue) des cartes cachées restent coupés par la colonne,
                sinon ils dépassent et allongent la page sous le footer. */}
            <ul className="relative -mx-1 flex max-h-[calc(100dvh-8rem)] min-h-0 flex-col gap-2 overflow-y-auto overscroll-contain px-1 py-1">
              {cards.map(({ id }) => (
                <li
                  key={id}
                  id={`kanban-card-${id}`}
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
      {opened && (
        <ColumnDialog
          column={opened}
          tickets={items.filter((item) => item.column === opened).map(({ id }) => ({ id, ...summary(id) }))}
          onClose={() => setOpened(null)}
          onSelect={reveal}
        />
      )}
    </div>
  );
}

type TicketSummary = { title: string; text: string; priority: TicketPriority; created_at: string; author: string };

const PERIODS = ["all", "7", "30", "90"] as const;
type Period = (typeof PERIODS)[number];
const DAY_MS = 24 * 60 * 60 * 1000;

// Recherche sans tenir compte des accents ni de la casse.
const normalize = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

// Tous les tickets d'une colonne (sans les filtres du tableau) : recherche texte, priorité, période et tri par date.
function ColumnDialog({
  column,
  tickets,
  onClose,
  onSelect,
}: {
  column: BoardColumn;
  tickets: ({ id: number } & TicketSummary)[];
  onClose: () => void;
  onSelect: (id: number) => void;
}) {
  const t = useTranslations("Admin.kanban");
  const format = useFormatter();
  const [query, setQuery] = useState("");
  const [priorities, setPriorities] = useState<TicketPriority[]>([]);
  const [period, setPeriod] = useState<Period>("all");
  const [order, setOrder] = useState<"newest" | "oldest">("newest");
  // Figée à l'ouverture : la période ne glisse pas pendant la recherche.
  const [now] = useState(() => Date.now());

  const words = normalize(query).split(/\s+/).filter(Boolean);
  const results = tickets
    .filter((ticket) => {
      const haystack = normalize(`#${ticket.id} ${ticket.title} ${ticket.text}`);
      if (!words.every((word) => haystack.includes(word))) return false;
      if (priorities.length > 0 && !priorities.includes(ticket.priority)) return false;
      return period === "all" || now - Date.parse(ticket.created_at) <= Number(period) * DAY_MS;
    })
    .sort((a, b) => (order === "newest" ? 1 : -1) * (Date.parse(b.created_at) - Date.parse(a.created_at)));

  function togglePriority(priority: TicketPriority) {
    setPriorities((current) => (current.includes(priority) ? current.filter((value) => value !== priority) : [...current, priority]));
  }

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={t("columnDialog.title", { column: t(`columns.${column}`), count: tickets.length })}
      closeLabel={t("columnDialog.close")}
    >
      <div className="flex flex-col gap-3">
        <label htmlFor="kanban-search" className="sr-only">
          {t("columnDialog.search")}
        </label>
        <Input
          id="kanban-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder={t("columnDialog.searchPlaceholder")}
          autoFocus
        />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <FilterBar label={t("priorityLabel")}>
            {TICKET_PRIORITIES.map((priority) => (
              <FilterChip key={priority} active={priorities.includes(priority)} onClick={() => togglePriority(priority)}>
                {t(`priorities.${priority}`)}
              </FilterChip>
            ))}
          </FilterBar>
          <div className="flex items-center gap-2">
            <label htmlFor="kanban-period" className="text-label-md text-ink-soft">
              {t("columnDialog.period")}
            </label>
            <select
              id="kanban-period"
              value={period}
              onChange={(event) => setPeriod(event.currentTarget.value as Period)}
              className={`h-9 py-0 ${FIELD_CLASS_NAME}`}
            >
              {PERIODS.map((value) => (
                <option key={value} value={value}>
                  {t(`columnDialog.periods.${value}`)}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setOrder((value) => (value === "newest" ? "oldest" : "newest"))}
              className="flex items-center gap-1 rounded-full px-2 py-1 font-display text-label-sm text-accent transition hover:bg-accent/10 focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none"
            >
              <Icon name="arrowUp" className={`size-3.5 transition ${order === "newest" ? "rotate-180" : ""}`} />
              {t(`columnDialog.order.${order}`)}
            </button>
          </div>
        </div>

        <p aria-live="polite" className="text-label-sm text-ink-soft">
          {t("columnDialog.results", { count: results.length })}
        </p>
        <ul className="flex max-h-[55dvh] flex-col gap-1.5 overflow-y-auto overscroll-contain">
          {results.map((ticket) => (
            <li key={ticket.id}>
              <button
                type="button"
                onClick={() => onSelect(ticket.id)}
                className="flex w-full flex-col gap-1 rounded-lg bg-surface-muted px-3 py-2.5 text-left transition hover:bg-accent/10 focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none"
              >
                <span className="flex items-start justify-between gap-3">
                  <span className="font-display text-label-lg text-ink">{ticket.title}</span>
                  <span className={`shrink-0 rounded-full border px-2 py-0.5 font-display text-label-sm ${PRIORITY_TONES[ticket.priority]}`}>
                    {t(`priorities.${ticket.priority}`)}
                  </span>
                </span>
                <span className="text-label-sm text-ink-soft">
                  #{ticket.id} · {ticket.author} · {format.dateTime(new Date(ticket.created_at), { dateStyle: "medium" })}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Dialog>
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

// Assignés d'une carte : avatars empilés, et liste des admins à cocher (dans la carte : une colonne qui défile couperait un menu flottant).
function AssigneePicker({ assignees, admins, onChange }: { assignees: Assignee[]; admins: Assignee[] | null; onChange: (ids: string[]) => void }) {
  const t = useTranslations("Admin.kanban");
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(root, open, close);
  const ids = assignees.map((assignee) => assignee.id);
  const full = ids.length >= TICKET_MAX_ASSIGNEES;

  function toggle(id: string) {
    onChange(ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id]);
  }

  return (
    <div ref={root} className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        {assignees.length > 0 ? (
          <ul aria-label={t("assigneesLabel")} className="flex -space-x-1.5">
            {assignees.map((assignee) => (
              <li key={assignee.id} title={assignee.display_name} className="rounded-lg ring-2 ring-surface">
                <Avatar
                  src={assignee.avatar_url}
                  name={assignee.avatar_seed ?? assignee.id}
                  backgroundColor={assignee.avatar_background_color}
                  alt={assignee.display_name}
                  size={24}
                />
              </li>
            ))}
          </ul>
        ) : (
          <span className="text-label-sm text-ink-soft">{t("unassigned")}</span>
        )}
        {admins && (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
            className="flex items-center gap-1 rounded-full px-2 py-0.5 font-display text-label-sm text-accent transition hover:bg-accent/10 focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none"
          >
            <Icon name={open ? "check" : "group"} className="size-3.5" />
            {open ? t("assignDone") : t("assign")}
          </button>
        )}
      </div>
      {open && admins && (
        <fieldset className="flex flex-col gap-1.5 rounded-lg bg-surface-muted p-2">
          <legend className="sr-only">{t("assigneesLabel")}</legend>
          {admins.map((admin) => {
            const checked = ids.includes(admin.id);
            return (
              <Checkbox key={admin.id} checked={checked} disabled={!checked && full} onChange={() => toggle(admin.id)}>
                <Avatar src={admin.avatar_url} name={admin.avatar_seed ?? admin.id} backgroundColor={admin.avatar_background_color} alt="" size={20} />
                <span className="truncate text-body-sm text-ink">{admin.display_name}</span>
              </Checkbox>
            );
          })}
          {full && <p className="text-label-sm text-ink-soft">{t("assigneesMax", { max: TICKET_MAX_ASSIGNEES })}</p>}
        </fieldset>
      )}
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
