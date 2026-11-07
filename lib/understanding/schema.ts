import { z } from 'zod';

/**
 * Structured result of "understanding" one inbound message (text, photo, or voice transcript).
 *
 * Design rules:
 * - Amounts are plain numbers in dollars. Unknown values are null, never guessed.
 * - Each result lists `needsReview` fields so the owner is asked about shaky values only.
 * - Bank balances are intentionally NOT part of the deposit-receipt shape (privacy).
 */

const amount = z.number().finite();
const optionalAmount = amount.nullable().optional();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');
const confidence = z.number().min(0).max(1);
const needsReview = z.array(z.string()).default([]);

export const PayoutSchema = z.object({
  /** Label exactly as the sender wrote it, e.g. "Lays". */
  label: z.string().min(1),
  amount,
  vendorHint: z.string().nullable().optional(),
});
export type Payout = z.infer<typeof PayoutSchema>;

/** One store's end-of-day report. A single message can contain several. */
export const DailyCloseReportSchema = z.object({
  /** Store name as written (may be misspelled). */
  storeHint: z.string().nullable(),
  reportDate: isoDate.nullable(),
  /** Inside (non-fuel) card/credit sales. */
  cardSales: optionalAmount,
  /** Inside (non-fuel) cash sales. */
  cashSales: optionalAmount,
  /** Inside sales total when written or printed (e.g. POS "Total Non Fuel Sales"). */
  storeSalesTotal: optionalAmount,
  /** Fuel sales exactly as the sender reports them (may be a cash-only figure). */
  fuelSales: optionalAmount,
  fuelGallons: optionalAmount,
  fuelDiscounts: optionalAmount,
  /** Money paid out of the till (vendors, refunds). */
  payouts: z.array(PayoutSchema).default([]),
  /** Deposit figure the sender wrote ("Total deposit ..."). */
  reportedDeposit: optionalAmount,
  /** Day total the sender or POS wrote ("Net cash", POS "Total Sales"). */
  reportedDayTotal: optionalAmount,
  /** False when the POS period is still open (partial day). */
  periodClosed: z.boolean().nullable().optional(),
});
export type DailyCloseReport = z.infer<typeof DailyCloseReportSchema>;

export const InvoiceLineSchema = z.object({
  description: z.string().default(''),
  quantity: z.number().finite().nullable().optional(),
  unitPrice: z.number().finite().nullable().optional(),
  amount,
});
export type InvoiceLine = z.infer<typeof InvoiceLineSchema>;

export const InvoiceSchema = z.object({
  vendorName: z.string().nullable(),
  invoiceNumber: z.string().nullable(),
  invoiceDate: isoDate.nullable(),
  /** Payment due date when printed ("Due date", "Pay by", Net 15/30). Null when none is shown. */
  dueDate: isoDate.nullable().optional(),
  storeHint: z.string().nullable().optional(),
  lineItems: z.array(InvoiceLineSchema).default([]),
  tax: optionalAmount,
  total: amount,
  paymentStatus: z.enum(['paid_cash', 'paid_other', 'unpaid', 'unknown']).default('unknown'),
});
export type Invoice = z.infer<typeof InvoiceSchema>;

export const CashCountSchema = z.object({
  denomination: z.number().positive(),
  count: z.number().int().nonnegative(),
});

/** ATM/branch deposit slip. No balance fields on purpose. */
export const DepositReceiptSchema = z.object({
  bank: z.string().nullable().optional(),
  /** Store name or branch location printed on the slip, as written (e.g. "Denville East Main St"). */
  storeHint: z.string().nullable().optional(),
  depositDate: isoDate.nullable(),
  postsOn: isoDate.nullable().optional(),
  accountLast4: z
    .string()
    .regex(/^\d{4}$/)
    .nullable()
    .optional(),
  totalDeposit: amount,
  /** Every bill-count line on the slip, across all sections. */
  cashCounts: z.array(CashCountSchema).default([]),
});
export type DepositReceipt = z.infer<typeof DepositReceiptSchema>;

export const EQUIPMENT_CATEGORIES = [
  'fuel_dispenser',
  'payment_network',
  'refrigeration',
  'pos_terminal',
  'other',
  'unknown',
] as const;
export type EquipmentCategory = (typeof EQUIPMENT_CATEGORIES)[number];

export const EquipmentIssueSchema = z.object({
  /** e.g. "Pump 4"; null when the message does not say. */
  equipment: z.string().nullable(),
  category: z.enum(EQUIPMENT_CATEGORIES).default('unknown'),
  description: z.string(),
  /** Text visible on the device screen, copied exactly. */
  screenText: z.string().nullable().optional(),
  severity: z.enum(['critical', 'high', 'normal', 'unknown']).default('unknown'),
  /** Short questions to ask the sender (at most two). */
  questions: z.array(z.string()).max(2).default([]),
});
export type EquipmentIssue = z.infer<typeof EquipmentIssueSchema>;

/** One shift on a staff schedule. Times are as the model read them ("17:00", "5pm"); code parses them. */
export const ShiftSchema = z.object({
  /** Calendar date when the sheet prints one for this shift. */
  date: isoDate.nullable().default(null),
  /** Weekday as written ("Mon", "Tuesday"), used with the week start when there is no date. */
  day: z.string().nullable().default(null),
  start: z.string().nullable().default(null),
  end: z.string().nullable().default(null),
  /** Unpaid break to subtract, only when the sheet says so. */
  breakMinutes: z.number().min(0).max(600).nullable().default(null),
});
export type Shift = z.infer<typeof ShiftSchema>;

/**
 * Privacy: there is deliberately no pay rate, wage or salary field. Hours only.
 */
export const EmployeeScheduleSchema = z.object({
  /** Name exactly as written on the sheet. */
  name: z.string().min(1),
  /** Total hours when the sheet prints one, used only to cross-check our own count. */
  statedTotalHours: z.number().min(0).max(200).nullable().default(null),
  /** Set by "FIX <name> <hours>" when the manager corrects the total (left early, swapped a shift). */
  adjustedHours: z.number().min(0).max(200).nullable().default(null),
  shifts: z.array(ShiftSchema).default([]),
});
export type EmployeeSchedule = z.infer<typeof EmployeeScheduleSchema>;

export const WorkScheduleSchema = z.object({
  storeHint: z.string().nullable().default(null),
  /** First date of the week the sheet covers. */
  weekStart: isoDate.nullable().default(null),
  employees: z.array(EmployeeScheduleSchema).min(1),
});
export type WorkSchedule = z.infer<typeof WorkScheduleSchema>;

/** A restock / order list (photo of a handwritten sheet, or typed "need 10 Marlboro"). */
export const OrderItemSchema = z.object({
  description: z.string().min(1),
  quantity: z.number().finite().nullable().optional(),
  unit: z.string().nullable().optional(),
});
export type OrderItem = z.infer<typeof OrderItemSchema>;

export const OrderSchema = z.object({
  storeHint: z.string().nullable().optional(),
  /** Vendor as written on the sheet or in the message ("HLA", "cig guy"). */
  vendorHint: z.string().nullable().optional(),
  items: z.array(OrderItemSchema).min(1),
});
export type Order = z.infer<typeof OrderSchema>;

export const UnderstandingSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('daily_close'),
    reports: z.array(DailyCloseReportSchema).min(1),
    confidence,
    needsReview,
  }),
  z.object({
    kind: z.literal('invoice'),
    invoice: InvoiceSchema,
    confidence,
    needsReview,
  }),
  z.object({
    kind: z.literal('deposit_receipt'),
    receipts: z.array(DepositReceiptSchema).min(1),
    confidence,
    needsReview,
  }),
  z.object({
    kind: z.literal('equipment_issue'),
    issue: EquipmentIssueSchema,
    confidence,
    needsReview,
  }),
  z.object({
    kind: z.literal('work_schedule'),
    schedule: WorkScheduleSchema,
    confidence,
    needsReview,
  }),
  z.object({
    kind: z.literal('order'),
    order: OrderSchema,
    confidence,
    needsReview,
  }),
  z.object({
    kind: z.literal('unknown'),
    reason: z.string(),
    confidence,
    needsReview,
  }),
]);
export type Understanding = z.infer<typeof UnderstandingSchema>;

export function unknownUnderstanding(reason: string): Understanding {
  return { kind: 'unknown', reason, confidence: 0, needsReview: [] };
}
