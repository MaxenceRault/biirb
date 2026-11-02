import { z } from "zod";

// Devises dont la BCE publie le taux (API Frankfurter).
export const CURRENCIES = [
  "EUR", "USD", "GBP", "CHF", "JPY", "CAD", "AUD", "NZD", "CNY", "HKD", "SGD", "KRW", "THB", "MYR", "IDR", "PHP",
  "INR", "ILS", "TRY", "MXN", "BRL", "ZAR", "SEK", "NOK", "DKK", "ISK", "PLN", "CZK", "HUF", "RON",
] as const;
export type Currency = (typeof CURRENCIES)[number];

// Unités mineures : centimes, sauf ces devises sans décimale.
const ZERO_DECIMAL: readonly string[] = ["JPY", "KRW", "ISK"];
export function currencyDecimals(currency: string) {
  return ZERO_DECIMAL.includes(currency) ? 0 : 2;
}

export const EXPENSE_CATEGORIES = ["lodging", "transport", "food", "activity", "other"] as const;
export const SPLIT_MODES = ["equal", "amounts", "shares"] as const;
export type SplitMode = (typeof SPLIT_MODES)[number];

// Alignés sur les contraintes de trip_expense.
export const AMOUNT_MAX_MINOR = 100_000_000_000;
const amountMinor = z.number().int().min(1).max(AMOUNT_MAX_MINOR);
const participantId = z.number().int().positive().max(2_147_483_647);
const MAX_SPLIT = 50;

// value : ignoré (parts égales), montant en unités mineures de la dépense, ou nombre de parts (2 décimales).
const splitSchema = z
  .strictObject({
    mode: z.enum(SPLIT_MODES),
    shares: z
      .array(z.strictObject({ participantId, value: z.number().positive().max(AMOUNT_MAX_MINOR) }))
      .min(1)
      .max(MAX_SPLIT),
  })
  .refine((split) => new Set(split.shares.map((share) => share.participantId)).size === split.shares.length)
  .refine((split) => split.mode !== "amounts" || split.shares.every((share) => Number.isInteger(share.value)))
  .refine((split) => split.mode !== "shares" || split.shares.every((share) => Number.isInteger(share.value * 100)));

export const expenseSchema = z
  .strictObject({
    title: z.string().trim().min(1).max(120),
    amount: amountMinor,
    currency: z.enum(CURRENCIES),
    paidBy: participantId,
    spentOn: z.iso.date(),
    category: z.enum(EXPENSE_CATEGORIES),
    split: splitSchema,
    // Dépense qui règle une ligne de la checklist « à payer » (cochée à l'enregistrement).
    paymentTaskId: participantId.optional(),
  })
  .refine((expense) => expense.split.mode !== "amounts" || expense.split.shares.reduce((sum, share) => sum + share.value, 0) === expense.amount, {
    path: ["split"],
  });

export const participantSchema = z.strictObject({
  name: z.string().trim().min(1).max(60),
});

// Remboursement d'un participant à un autre, dans la devise du voyage.
export const settlementSchema = z
  .strictObject({ from: participantId, to: participantId, amount: amountMinor })
  .refine((settlement) => settlement.from !== settlement.to);

export const paymentTaskSchema = z.strictObject({
  label: z.string().trim().min(1).max(120),
  estimated: amountMinor.nullable(),
  assigneeId: participantId.nullable(),
});

export const updatePaymentTaskSchema = z
  .strictObject({
    label: z.string().trim().min(1).max(120),
    estimated: amountMinor.nullable(),
    assigneeId: participantId.nullable(),
    done: z.boolean(),
  })
  .partial()
  .refine((changes) => Object.keys(changes).length > 0);

export const tripCurrencySchema = z.strictObject({ currency: z.enum(CURRENCIES) });

export type ExpenseInput = z.infer<typeof expenseSchema>;
export type SettlementInput = z.infer<typeof settlementSchema>;
export type PaymentTaskInput = z.infer<typeof paymentTaskSchema>;
export type UpdatePaymentTaskInput = z.infer<typeof updatePaymentTaskSchema>;

// GET /api/v1/trips/[id]/expenses?display= : devise d'affichage des comptes (celle du voyage ou d'une dépense).
export const ledgerQuerySchema = z.strictObject({ display: z.enum(CURRENCIES).optional() });
