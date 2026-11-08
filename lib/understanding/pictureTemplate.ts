/**
 * Owner-taught picture maps: what to take (and ignore) on a close/invoice photo
 * for this store. The file is not kept; the labels drive later AI reads.
 */
import { z } from 'zod';

export const PICTURE_TEMPLATE_KINDS = ['daily_close', 'invoice', 'deposit_receipt', 'order'] as const;
export type PictureTemplateKind = (typeof PICTURE_TEMPLATE_KINDS)[number];

export const PICTURE_FIELD_PURPOSES = ['fuel', 'store_credit', 'cash', 'payout', 'ignore'] as const;
export type PictureFieldPurpose = (typeof PICTURE_FIELD_PURPOSES)[number];

export const MAX_PICTURE_TEMPLATES = 6;
export const MAX_PICTURE_FIELDS = 8;

export const PictureFieldSchema = z.object({
  label: z.string().trim().min(1).max(80),
  purpose: z.enum(PICTURE_FIELD_PURPOSES),
  note: z.string().trim().max(120).optional(),
});

export const PictureTemplateSchema = z.object({
  id: z.string().trim().min(1).max(40),
  kind: z.enum(PICTURE_TEMPLATE_KINDS),
  title: z.string().trim().min(1).max(80),
  note: z.string().trim().max(400).optional(),
  fields: z.array(PictureFieldSchema).min(1).max(MAX_PICTURE_FIELDS),
});

export type PictureTemplate = z.infer<typeof PictureTemplateSchema>;
export type PictureField = z.infer<typeof PictureFieldSchema>;

export const PICTURE_PURPOSE_LABEL: Record<PictureFieldPurpose, string> = {
  fuel: 'Fuel',
  store_credit: 'Store credit (inside card)',
  cash: 'Cash (acceptor / till)',
  payout: 'Comes off cash (invoice / paid-out)',
  ignore: 'Ignore (not today’s sales)',
};

const PURPOSE_PROMPT: Record<PictureFieldPurpose, string> = {
  fuel: 'fuelSales',
  store_credit: 'cardSales / store credit (inside non-fuel)',
  cash: 'cashSales (Cash Acceptor Cash / till cash)',
  payout: 'a payout that comes off cash — never wages or pay rates',
  ignore: 'ignore (not today’s sales)',
};

export interface PictureTemplatePreset {
  id: string;
  title: string;
  kind: PictureTemplateKind;
  note: string;
  fields: PictureField[];
}

/** Known layouts the owner can start from, then tweak. */
export const PICTURE_TEMPLATE_PRESETS: PictureTemplatePreset[] = [
  {
    id: 'exxon_store_close',
    title: 'Exxon Store Close (fuel page)',
    kind: 'daily_close',
    note: 'Fuel is Total Fuel Sales. Non-fuel, if any, is store credit. Ignore the register reading.',
    fields: [
      { label: 'Total Fuel Sales', purpose: 'fuel' },
      { label: 'Total Non Fuel Sales', purpose: 'store_credit' },
      { label: 'Grand Total Store Sales Reading', purpose: 'ignore', note: 'register reading, not today' },
    ],
  },
  {
    id: 'exxon_tender',
    title: 'Exxon tender page (cash)',
    kind: 'daily_close',
    note: 'Cash is Cash Acceptor Cash, not the Cash row. Pump CRIND stays in fuel. Paid-outs come off this cash.',
    fields: [
      { label: 'Cash Acceptor Cash', purpose: 'cash' },
      { label: 'Cash', purpose: 'ignore', note: 'often $0, not the till cash' },
      { label: 'Credit CRIND', purpose: 'ignore', note: 'pump cards, already in fuel' },
    ],
  },
  {
    id: 'notebook_store_sales',
    title: 'Handwritten store sales',
    kind: 'daily_close',
    note: 'Read the footer totals only. Product lines are not an order.',
    fields: [
      { label: 'Store Credit', purpose: 'store_credit' },
      { label: 'Store Cash', purpose: 'cash' },
      { label: 'Gas', purpose: 'fuel' },
      { label: 'ATM / named paid-out', purpose: 'payout' },
      { label: 'product lines (Marlboro, Lava, …)', purpose: 'ignore' },
    ],
  },
];

export function newPictureTemplateId(): string {
  return `pic_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function templateFromPreset(presetId: string): Omit<PictureTemplate, 'id'> | null {
  const preset = PICTURE_TEMPLATE_PRESETS.find((p) => p.id === presetId);
  if (!preset) return null;
  return {
    kind: preset.kind,
    title: preset.title,
    note: preset.note,
    fields: preset.fields.map((f) => ({ ...f })),
  };
}

function cleanField(field: { label?: string; purpose: PictureFieldPurpose; note?: string }): PictureField | null {
  const label = (field.label ?? '').trim().slice(0, 80);
  if (!label) return null;
  const note = field.note?.trim().slice(0, 120) || undefined;
  return { label, purpose: field.purpose, ...(note ? { note } : {}) };
}

export function cleanPictureTemplate(input: {
  id?: string;
  kind: PictureTemplateKind;
  title: string;
  note?: string;
  fields: Array<{ label?: string; purpose: PictureFieldPurpose; note?: string }>;
}): PictureTemplate | null {
  const title = input.title.trim().slice(0, 80) || 'Picture map';
  const fields = input.fields.map(cleanField).filter((f): f is PictureField => Boolean(f)).slice(0, MAX_PICTURE_FIELDS);
  if (fields.length === 0) return null;
  const note = input.note?.trim().slice(0, 400) || undefined;
  return {
    id: input.id?.trim() || newPictureTemplateId(),
    kind: input.kind,
    title,
    ...(note ? { note } : {}),
    fields,
  };
}

/** One line the owner sees after save. */
export function describePictureTemplate(template: PictureTemplate): string {
  const takes = template.fields
    .filter((f) => f.purpose !== 'ignore')
    .map((f) => `${f.label} → ${PICTURE_PURPOSE_LABEL[f.purpose]}`);
  const ignores = template.fields.filter((f) => f.purpose === 'ignore').map((f) => f.label);
  const parts = [template.title, ...takes];
  if (ignores.length) parts.push(`ignore ${ignores.join(', ')}`);
  return parts.join(' · ');
}

/** Vocabulary injected into the extraction prompt for this store. */
export function pictureMapsForPrompt(templates: PictureTemplate[]): string[] {
  return templates.slice(0, MAX_PICTURE_TEMPLATES).map((t) => {
    const fields = t.fields
      .map((f) => {
        const extra = f.note ? ` (${f.note})` : '';
        const verb = f.purpose === 'ignore' ? 'ignore' : 'take';
        return `${verb} "${f.label}" as ${PURPOSE_PROMPT[f.purpose]}${extra}`;
      })
      .join('; ');
    const note = t.note ? ` Owner note: ${t.note.slice(0, 240)}` : '';
    return `picture map "${t.title}" (${t.kind}): ${fields}.${note} Follow this map when the photo looks like that page. Copy printed numbers; do not invent.`;
  });
}
