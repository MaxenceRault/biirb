"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Checkbox } from "@/components/ui/Checkbox";
import { Field } from "@/components/ui/Field";
import { FormError } from "@/components/ui/FormError";
import { Icon, type IconName } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import { FIELD_CLASS_NAME, Input } from "@/components/ui/Input";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import type { TripRole } from "@/components/TripSharePanel";
import { apiFetch } from "@/client/session";
import { CURRENCIES, currencyDecimals, EXPENSE_CATEGORIES, SPLIT_MODES, type SplitMode } from "@/schemas/trip-expense.schema";

type Category = (typeof EXPENSE_CATEGORIES)[number];
type Participant = { id: number; user_id: string | null; name: string; is_guest: boolean; has_access: boolean };
type Expense = {
  id: number;
  title: string;
  amount_minor: number;
  currency: string;
  base_amount_minor: number;
  paid_by: number;
  spent_on: string;
  category: Category;
  split_mode: SplitMode;
  is_reimbursement: boolean;
  editable: boolean;
  shares: { participant_id: number; weight: number; share_minor: number }[];
};
type PaymentTask = { id: number; label: string; estimated_minor: number | null; assignee_id: number | null; done: boolean };
type Ledger = {
  role: TripRole;
  currency: string;
  me: number | null;
  participants: Participant[];
  expenses: Expense[];
  total: number;
  spentByCategory: Partial<Record<Category, number>>;
  budget: Partial<Record<Category, number>> | null;
  balances: { participant_id: number; balance: number }[];
  settlements: { from: number; to: number; amount: number }[];
  paymentTasks: PaymentTask[];
};

const ERRORS = [
  "INVALID_INPUT",
  "FORBIDDEN",
  "NOT_FOUND",
  "PARTICIPANT_IN_USE",
  "TRIP_FULL",
  "CURRENCY_LOCKED",
  "RATE_UNAVAILABLE",
  "TOO_MANY_REQUESTS",
  "INTERNAL_ERROR",
] as const;
type ExpenseError = (typeof ERRORS)[number];

const CATEGORY_ICONS: Record<Category, IconName> = {
  lodging: "hotel",
  transport: "train",
  food: "restaurant",
  activity: "explore",
  other: "category",
};

// Formulaire ouvert : nouvelle dépense, modification, ou règlement d'une ligne « à payer ».
type Draft = { expense?: Expense; task?: PaymentTask };

export function TripExpenses({ tripId }: { tripId: string }) {
  const t = useTranslations("Planner.expenses");
  const router = useRouter();
  const basePath = `/api/v1/trips/${tripId}`;
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [error, setError] = useState<ExpenseError | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  const fail = useCallback(
    (code: string) => {
      if (code === "UNAUTHORIZED") return router.replace("/login");
      setError(ERRORS.find((known) => known === code) ?? "INTERNAL_ERROR");
    },
    [router],
  );

  useEffect(() => {
    apiFetch<Ledger>(`${basePath}/expenses`).then((result) => ("data" in result ? setLedger(result.data) : fail(result.error)));
  }, [basePath, fail]);

  async function mutate(path: string, method: string, body?: unknown) {
    setError(null);
    const result = await apiFetch<Ledger>(`${basePath}${path}`, { method, body });
    if ("data" in result) {
      setLedger(result.data);
      return true;
    }
    fail(result.error);
    return false;
  }

  if (!ledger) return error ? <FormError>{t(`errors.${error}`)}</FormError> : <Card className="h-96 animate-pulse bg-surface-muted" />;

  const canEdit = ledger.role !== "viewer";
  const name = (id: number | null) => ledger.participants.find((participant) => participant.id === id)?.name ?? "?";

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <div role="alert">
          <FormError>{t(`errors.${error}`)}</FormError>
        </div>
      )}
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex flex-col gap-6">
          {draft ? (
            <ExpenseForm
              ledger={ledger}
              draft={draft}
              onCancel={() => setDraft(null)}
              onSubmit={async (body) => {
                const ok = draft.expense
                  ? await mutate(`/expenses/${draft.expense.id}`, "PUT", body)
                  : await mutate("/expenses", "POST", { ...body, ...(draft.task ? { paymentTaskId: draft.task.id } : {}) });
                if (ok) setDraft(null);
              }}
            />
          ) : (
            <Button onClick={() => setDraft({})} className="gap-1.5 self-start" disabled={ledger.me === null && !canEdit}>
              <Icon name="add" className="size-4" />
              {t("add")}
            </Button>
          )}
          <ExpenseList ledger={ledger} name={name} onEdit={(expense) => setDraft({ expense })} mutate={mutate} />
        </div>

        <aside className="flex flex-col gap-6">
          <BalancesCard ledger={ledger} name={name} mutate={mutate} />
          <PaymentTasksCard ledger={ledger} name={name} mutate={mutate} onPay={(task) => setDraft({ task })} />
          <ParticipantsCard ledger={ledger} mutate={mutate} />
          {ledger.budget && <BudgetComparison ledger={ledger} />}
        </aside>
      </div>
    </div>
  );
}

function useMoney(currency: string) {
  const format = useFormatter();
  return (minor: number, code = currency) => format.number(minor / 10 ** currencyDecimals(code), { style: "currency", currency: code });
}

function ExpenseList({
  ledger,
  name,
  onEdit,
  mutate,
}: {
  ledger: Ledger;
  name: (id: number | null) => string;
  onEdit: (expense: Expense) => void;
  mutate: (path: string, method: string, body?: unknown) => Promise<boolean>;
}) {
  const t = useTranslations("Planner.expenses");
  const confirm = useConfirm();
  const format = useFormatter();
  const money = useMoney(ledger.currency);

  return (
    <Card className="flex flex-col gap-4 p-6">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-display text-headline-sm text-ink">{t("title")}</h2>
        <span className="font-display text-label-lg text-ink">{t("total", { amount: money(ledger.total) })}</span>
      </div>
      {ledger.expenses.length === 0 && <p className="text-body-sm text-ink-soft">{t("empty")}</p>}
      <ul className="flex flex-col gap-2">
        {ledger.expenses.map((expense) => (
          <li key={expense.id} className="flex items-center gap-3 rounded-lg bg-surface-muted px-4 py-3">
            <Icon name={expense.is_reimbursement ? "check" : CATEGORY_ICONS[expense.category]} className="size-5 shrink-0 text-ink-soft" />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate font-display text-label-lg text-ink">
                {expense.is_reimbursement
                  ? t("reimbursement", { from: name(expense.paid_by), to: name(expense.shares[0]?.participant_id ?? null) })
                  : expense.title}
              </span>
              <span className="text-label-sm text-ink-soft">
                {t("paidBy", {
                  name: name(expense.paid_by),
                  date: format.dateTime(new Date(`${expense.spent_on}T12:00:00`), { day: "numeric", month: "short" }),
                })}
                {!expense.is_reimbursement && ` · ${t("splitBetween", { count: expense.shares.length })}`}
              </span>
            </div>
            <div className="flex shrink-0 flex-col items-end">
              <span className="font-display text-label-lg text-ink">{money(expense.base_amount_minor)}</span>
              {expense.currency !== ledger.currency && (
                <span className="text-label-sm text-ink-soft">{money(expense.amount_minor, expense.currency)}</span>
              )}
            </div>
            {expense.editable && (
              <div className="flex shrink-0">
                {!expense.is_reimbursement && (
                  <IconButton icon="edit" label={t("edit", { title: expense.title })} onClick={() => onEdit(expense)} />
                )}
                <IconButton
                  icon="delete"
                  label={t("delete", { title: expense.title })}
                  onClick={async () => {
                    if (await confirm({
                      title: t("deleteConfirm.title"),
                      message: t("deleteConfirm.message"),
                      confirmLabel: t("deleteConfirm.action"),
                      icon: "delete",
                      danger: true,
                    })) void mutate(`/expenses/${expense.id}`, "DELETE");
                  }}
                />
              </div>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function ExpenseForm({
  ledger,
  draft,
  onSubmit,
  onCancel,
}: {
  ledger: Ledger;
  draft: Draft;
  onSubmit: (body: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
}) {
  const t = useTranslations("Planner.expenses");
  const { expense, task } = draft;
  const canEdit = ledger.role !== "viewer";
  const today = new Date().toISOString().slice(0, 10);
  const [currency, setCurrency] = useState(expense?.currency ?? ledger.currency);
  const [mode, setMode] = useState<SplitMode>(expense?.split_mode ?? "equal");
  // Participants cochés et valeur saisie (montant ou parts) pour chacun.
  const [values, setValues] = useState<Record<number, string>>(() =>
    Object.fromEntries(
      expense
        ? expense.shares.map((share) => [
            share.participant_id,
            expense.split_mode === "amounts" ? toInput(share.weight, expense.currency) : String(share.weight),
          ])
        : ledger.participants.map((participant) => [participant.id, "1"]),
    ),
  );
  const [pending, setPending] = useState(false);
  const [localError, setLocalError] = useState(false);
  const decimals = currencyDecimals(currency);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const amount = toMinor(String(form.get("amount")), decimals);
    const shares = Object.entries(values)
      .filter(([, value]) => value !== "")
      .map(([participantId, value]) => ({
        participantId: Number(participantId),
        value: mode === "amounts" ? toMinor(value, decimals) : mode === "shares" ? Number(value.replace(",", ".")) : 1,
      }));
    if (!amount || shares.length === 0 || shares.some((share) => !share.value || share.value < 0)) return setLocalError(true);

    setLocalError(false);
    setPending(true);
    await onSubmit({
      title: String(form.get("title")),
      amount,
      currency,
      paidBy: Number(form.get("paidBy")),
      spentOn: String(form.get("spentOn")),
      category: String(form.get("category")),
      split: { mode, shares },
    });
    setPending(false);
  }

  function toggle(id: number, checked: boolean) {
    setValues((current) => {
      const next = { ...current };
      if (checked) next[id] = mode === "amounts" ? "" : "1";
      else delete next[id];
      return next;
    });
  }

  return (
    <Card className="flex flex-col gap-4 p-6">
      <h2 className="font-display text-headline-sm text-ink">{t(expense ? "editTitle" : task ? "payTitle" : "addTitle")}</h2>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field id="expense-title" label={t("fields.title")}>
          <Input id="expense-title" name="title" required maxLength={120} defaultValue={expense?.title ?? task?.label ?? ""} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_120px]">
          <Field id="expense-amount" label={t("fields.amount")}>
            <Input
              id="expense-amount"
              name="amount"
              inputMode="decimal"
              required
              pattern="[0-9]+([.,][0-9]{1,2})?"
              defaultValue={
                expense ? toInput(expense.amount_minor, expense.currency) : task?.estimated_minor ? toInput(task.estimated_minor, ledger.currency) : ""
              }
            />
          </Field>
          <Field id="expense-currency" label={t("fields.currency")}>
            <select
              id="expense-currency"
              value={currency}
              onChange={(event) => setCurrency(event.currentTarget.value)}
              className={`h-11 ${FIELD_CLASS_NAME}`}
            >
              {CURRENCIES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field id="expense-paid-by" label={t("fields.paidBy")}>
            <select
              id="expense-paid-by"
              name="paidBy"
              defaultValue={expense?.paid_by ?? task?.assignee_id ?? ledger.me ?? ledger.participants[0]?.id}
              className={`h-11 ${FIELD_CLASS_NAME}`}
            >
              {/* Lecteur : seulement ses propres dépenses. */}
              {ledger.participants
                .filter((participant) => canEdit || participant.id === ledger.me)
                .map((participant) => (
                  <option key={participant.id} value={participant.id}>
                    {participant.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field id="expense-date" label={t("fields.date")}>
            <Input id="expense-date" name="spentOn" type="date" required defaultValue={expense?.spent_on ?? today} />
          </Field>
          <Field id="expense-category" label={t("fields.category")}>
            <select id="expense-category" name="category" defaultValue={expense?.category ?? "food"} className={`h-11 ${FIELD_CLASS_NAME}`}>
              {EXPENSE_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {t(`categories.${category}`)}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 font-display text-label-lg text-ink">{t("fields.split")}</legend>
          <div role="radiogroup" aria-label={t("fields.split")} className="flex gap-1 rounded-lg bg-surface-muted p-1">
            {SPLIT_MODES.map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={mode === value}
                onClick={() => {
                  setMode(value);
                  setValues((current) => Object.fromEntries(Object.keys(current).map((id) => [id, value === "amounts" ? "" : "1"])));
                }}
                className={`flex-1 rounded-lg px-3 py-2 font-display text-label-md transition ${
                  mode === value ? "bg-surface text-ink shadow-sm" : "text-ink-soft hover:text-ink"
                }`}
              >
                {t(`modes.${value}`)}
              </button>
            ))}
          </div>
          <ul className="flex flex-col gap-1.5">
            {ledger.participants.map((participant) => {
              const included = participant.id in values;
              return (
                <li key={participant.id} className="flex items-center gap-3">
                  <Checkbox checked={included} onChange={(event) => toggle(participant.id, event.currentTarget.checked)} className="flex-1">
                    <span className="text-ink">{participant.name}</span>
                  </Checkbox>
                  {included && mode !== "equal" && (
                    <Input
                      aria-label={t(mode === "amounts" ? "shareAmount" : "shareParts", { name: participant.name })}
                      inputMode="decimal"
                      value={values[participant.id]}
                      onChange={(event) => {
                        const value = event.currentTarget.value;
                        setValues((current) => ({ ...current, [participant.id]: value }));
                      }}
                      className="h-9 max-w-28"
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </fieldset>

        {localError && <FormError>{t("errors.INVALID_INPUT")}</FormError>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel}>
            {t("cancel")}
          </Button>
          <Button type="submit" disabled={pending}>
            {t("save")}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function BalancesCard({
  ledger,
  name,
  mutate,
}: {
  ledger: Ledger;
  name: (id: number | null) => string;
  mutate: (path: string, method: string, body?: unknown) => Promise<boolean>;
}) {
  const t = useTranslations("Planner.expenses");
  const money = useMoney(ledger.currency);
  const canEdit = ledger.role !== "viewer";

  return (
    <Card className="flex flex-col gap-4 p-6">
      <h2 className="font-display text-headline-sm text-ink">{t("balances")}</h2>
      <ul className="flex flex-col gap-1.5">
        {ledger.balances.map((balance) => (
          <li key={balance.participant_id} className="flex items-center justify-between gap-3 text-body-sm">
            <span className="text-ink">{name(balance.participant_id)}</span>
            <span className={`font-display text-label-lg ${balance.balance > 0 ? "text-ink" : balance.balance < 0 ? "text-error" : "text-ink-soft"}`}>
              {balance.balance > 0 && "+"}
              {money(balance.balance)}
            </span>
          </li>
        ))}
      </ul>

      <h3 className="font-display text-label-lg text-ink">{t("settlements")}</h3>
      {ledger.settlements.length === 0 ? (
        <p className="text-body-sm text-ink-soft">{t("settled")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {ledger.settlements.map((settlement) => (
            <li key={`${settlement.from}-${settlement.to}`} className="flex flex-col gap-2 rounded-lg bg-surface-muted p-3">
              <span className="text-body-sm text-ink">
                {t.rich("owes", {
                  from: name(settlement.from),
                  to: name(settlement.to),
                  amount: money(settlement.amount),
                  strong: (chunks) => <strong className="font-semibold">{chunks}</strong>,
                })}
              </span>
              {(canEdit || settlement.from === ledger.me) && (
                <Button size="sm" variant="secondary" className="gap-1.5 self-end" onClick={() => void mutate("/settlements", "POST", settlement)}>
                  <Icon name="check" className="size-4" />
                  {t("markPaid")}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function PaymentTasksCard({
  ledger,
  name,
  mutate,
  onPay,
}: {
  ledger: Ledger;
  name: (id: number | null) => string;
  mutate: (path: string, method: string, body?: unknown) => Promise<boolean>;
  onPay: (task: PaymentTask) => void;
}) {
  const t = useTranslations("Planner.expenses");
  const money = useMoney(ledger.currency);
  const canEdit = ledger.role !== "viewer";

  async function handleAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const estimated = String(form.get("estimated") ?? "").trim();
    const assignee = String(form.get("assigneeId") ?? "");
    const ok = await mutate("/payment-tasks", "POST", {
      label: String(form.get("label")),
      estimated: estimated ? toMinor(estimated, currencyDecimals(ledger.currency)) : null,
      assigneeId: assignee ? Number(assignee) : null,
    });
    if (ok) formElement.reset();
  }

  return (
    <Card className="flex flex-col gap-4 p-6">
      <div className="flex flex-col gap-1">
        <h2 className="font-display text-headline-sm text-ink">{t("tasks.title")}</h2>
        <p className="text-body-sm text-ink-soft">{t("tasks.hint")}</p>
      </div>
      {ledger.paymentTasks.length === 0 && <p className="text-body-sm text-ink-soft">{t("tasks.empty")}</p>}
      <ul className="flex flex-col gap-2">
        {ledger.paymentTasks.map((task) => {
          // Cocher = payer : ouvre la dépense pré-remplie (éditeur, ou la personne à qui c'est attribué).
          const canPay = !task.done && (canEdit || task.assignee_id === ledger.me);
          return (
            <li key={task.id} className="flex items-start gap-2 rounded-lg bg-surface-muted px-3 py-2.5">
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <Checkbox checked={task.done} disabled={!canPay} onChange={() => onPay(task)} className="items-start">
                  <span className={task.done ? "text-ink-soft line-through" : "text-ink"}>{task.label}</span>
                </Checkbox>
                <span className="pl-6.5 text-label-sm text-ink-soft">
                  {[task.assignee_id !== null && name(task.assignee_id), task.estimated_minor !== null && `≈ ${money(task.estimated_minor)}`]
                    .filter(Boolean)
                    .join(" · ") || t("tasks.unassigned")}
                </span>
              </div>
              {canEdit && (
                <IconButton
                  icon="close"
                  label={t("tasks.delete", { label: task.label })}
                  onClick={() => void mutate(`/payment-tasks/${task.id}`, "DELETE")}
                />
              )}
            </li>
          );
        })}
      </ul>
      {canEdit && (
        <form onSubmit={handleAdd} className="flex flex-col gap-2">
          <label htmlFor="payment-label" className="sr-only">
            {t("tasks.label")}
          </label>
          <Input id="payment-label" name="label" required maxLength={120} placeholder={t("tasks.placeholder")} />
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2">
            <label htmlFor="payment-estimated" className="sr-only">
              {t("tasks.estimated")}
            </label>
            <Input id="payment-estimated" name="estimated" inputMode="decimal" pattern="[0-9]+([.,][0-9]{1,2})?" placeholder={t("tasks.estimated")} />
            <label htmlFor="payment-assignee" className="sr-only">
              {t("tasks.assignee")}
            </label>
            <select id="payment-assignee" name="assigneeId" defaultValue="" className={`h-11 ${FIELD_CLASS_NAME}`}>
              <option value="">{t("tasks.assignee")}</option>
              {ledger.participants.map((participant) => (
                <option key={participant.id} value={participant.id}>
                  {participant.name}
                </option>
              ))}
            </select>
            <Button type="submit" variant="secondary">
              {t("tasks.add")}
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}

function ParticipantsCard({ ledger, mutate }: { ledger: Ledger; mutate: (path: string, method: string, body?: unknown) => Promise<boolean> }) {
  const t = useTranslations("Planner.expenses");
  const canEdit = ledger.role !== "viewer";

  async function handleAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (await mutate("/participants", "POST", { name: String(new FormData(form).get("name")) })) form.reset();
  }

  return (
    <Card className="flex flex-col gap-4 p-6">
      <h2 className="font-display text-headline-sm text-ink">{t("participants.title")}</h2>
      <ul className="flex flex-wrap gap-2">
        {ledger.participants.map((participant) => (
          <li key={participant.id} className="inline-flex items-center gap-1.5 rounded-lg bg-surface-muted py-1 pr-1 pl-3 text-body-sm text-ink">
            {participant.name}
            {participant.is_guest && <Badge>{t("participants.guest")}</Badge>}
            {canEdit && participant.is_guest ? (
              <IconButton
                icon="close"
                label={t("participants.remove", { name: participant.name })}
                onClick={() => void mutate(`/participants/${participant.id}`, "DELETE")}
              />
            ) : (
              <span className="w-1" />
            )}
          </li>
        ))}
      </ul>
      {canEdit && (
        <form onSubmit={handleAdd} className="flex gap-2">
          <label htmlFor="participant-name" className="sr-only">
            {t("participants.add")}
          </label>
          <Input id="participant-name" name="name" required maxLength={60} placeholder={t("participants.placeholder")} />
          <Button type="submit" variant="secondary" className="shrink-0">
            {t("participants.add")}
          </Button>
        </form>
      )}
      {canEdit && ledger.expenses.length === 0 && <CurrencyPicker ledger={ledger} mutate={mutate} />}
    </Card>
  );
}

// Devise du voyage : modifiable tant qu'aucune dépense n'est saisie.
function CurrencyPicker({ ledger, mutate }: { ledger: Ledger; mutate: (path: string, method: string, body?: unknown) => Promise<boolean> }) {
  const t = useTranslations("Planner.expenses");
  return (
    <Field id="trip-currency" label={t("currency")}>
      <select
        id="trip-currency"
        value={ledger.currency}
        onChange={(event) => void mutate("/currency", "PUT", { currency: event.currentTarget.value })}
        className={`h-11 ${FIELD_CLASS_NAME}`}
      >
        {CURRENCIES.map((code) => (
          <option key={code} value={code}>
            {code}
          </option>
        ))}
      </select>
    </Field>
  );
}

function BudgetComparison({ ledger }: { ledger: Ledger }) {
  const t = useTranslations("Planner.expenses");
  const money = useMoney(ledger.currency);
  const categories = EXPENSE_CATEGORIES.filter((category) => category !== "other");

  return (
    <Card className="flex flex-col gap-4 p-6">
      <h2 className="font-display text-headline-sm text-ink">{t("budget.title")}</h2>
      <ul className="flex flex-col gap-3">
        {categories.map((category) => {
          const spent = ledger.spentByCategory[category] ?? 0;
          const planned = ledger.budget?.[category] ?? 0;
          const over = planned > 0 && spent > planned;
          return (
            <li key={category} className="flex flex-col gap-1">
              <span className="flex justify-between gap-3 text-body-sm">
                <span className="text-ink">{t(`categories.${category}`)}</span>
                <span className={over ? "text-error" : "text-ink-soft"}>{t("budget.row", { spent: money(spent), planned: money(planned) })}</span>
              </span>
              <span className="h-1.5 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
                <span
                  className={`block h-full rounded-full ${over ? "bg-error" : "bg-ink"}`}
                  style={{ width: `${planned > 0 ? Math.min(100, Math.round((spent / planned) * 100)) : spent > 0 ? 100 : 0}%` }}
                />
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

// « 12,5 » → 1250 (centimes) ; 0 si la saisie n'est pas un montant.
function toMinor(value: string, decimals: number) {
  const number = Number(value.trim().replace(",", "."));
  return Number.isFinite(number) && number > 0 ? Math.round(number * 10 ** decimals) : 0;
}

function toInput(minor: number, currency: string) {
  const decimals = currencyDecimals(currency);
  return (minor / 10 ** decimals).toFixed(decimals).replace(".", ",");
}
