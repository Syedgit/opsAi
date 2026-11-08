import OpenAI from 'openai';
import {
  MAX_PICTURE_FIELDS,
  PICTURE_FIELD_PURPOSES,
  PICTURE_KIND_LABEL,
  PICTURE_PURPOSE_LABEL,
  PICTURE_TEMPLATE_KINDS,
  cleanPictureTemplate,
  type PictureTemplate,
  type PictureTemplateKind,
} from './pictureTemplate';
import { getAiConfig } from './config';
import type { ChatClientLike } from './extractor';

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MIN_BASE64 = 80;
const MAX_BASE64 = 2_500_000;

export type ProposedPictureMap = Omit<PictureTemplate, 'id'>;

export function buildProposePictureMapPrompt(kind: PictureTemplateKind): string {
  const purposes = PICTURE_FIELD_PURPOSES
    .map((id) => `- ${id}: ${PICTURE_PURPOSE_LABEL[id]}`)
    .join('\n');
  return `You look at one photo of store paperwork. List the printed or handwritten labels that matter for later reads. Do not copy dollar amounts, gallons numbers, or dates.

This page is a ${PICTURE_KIND_LABEL[kind]} (${kind}).

Return ONE JSON object:
{"kind":"${kind}","title":"short name of this page","note":"one sentence: what this page is and what to ignore","fields":[{"label":"exact line as printed","purpose":"one purpose id","note":"optional hint"}]}

Purposes:
${purposes}

Rules:
- Copy labels exactly as printed or written. Never invent a label that is not on the page.
- Prefer totals over product-mix, grade, or SKU lines.
- Meter readings, register readings, CRIND/pump-card lines, transaction counts, and far-future period dates are ignore.
- If this looks like a fuel/sales page, take fuel dollars, gallons/volume on the fuel total, and non-fuel / store credit. If this looks like a tender/cash page, take the till or cash-acceptor line and ignore pump-card tenders.
- If you are unsure, purpose is ignore and say why in note.
- At most ${MAX_PICTURE_FIELDS} fields. kind must be "${kind}".`;
}

export function parseProposedPictureMap(
  raw: string | null | undefined,
  kind: PictureTemplateKind
): ProposedPictureMap | null {
  if (!raw?.trim()) return null;
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let json: unknown;
  try {
    json = JSON.parse(cleaned);
  } catch {
    return null;
  }
  if (!json || typeof json !== 'object') return null;
  const row = json as Record<string, unknown>;
  const fieldsRaw = Array.isArray(row.fields) ? row.fields : [];
  const fields = fieldsRaw.flatMap((field) => {
    if (!field || typeof field !== 'object') return [];
    const f = field as Record<string, unknown>;
    const label = typeof f.label === 'string' ? f.label : '';
    const purpose = PICTURE_FIELD_PURPOSES.includes(f.purpose as (typeof PICTURE_FIELD_PURPOSES)[number])
      ? (f.purpose as (typeof PICTURE_FIELD_PURPOSES)[number])
      : 'ignore';
    const note = typeof f.note === 'string' ? f.note : undefined;
    return [{ label, purpose, note }];
  });
  const title = typeof row.title === 'string' && row.title.trim() ? row.title : PICTURE_KIND_LABEL[kind];
  const note = typeof row.note === 'string' ? row.note : undefined;
  const requestedKind = PICTURE_TEMPLATE_KINDS.includes(row.kind as PictureTemplateKind)
    ? (row.kind as PictureTemplateKind)
    : kind;
  return cleanPictureTemplate({
    kind: requestedKind === kind ? requestedKind : kind,
    title,
    note,
    fields,
  });
}

export async function proposePictureMapFromPhoto(
  image: { base64: string; mimeType: string },
  kind: PictureTemplateKind = 'daily_close',
  client?: ChatClientLike | null
): Promise<{ ok: true; template: ProposedPictureMap } | { ok: false; error: string }> {
  const mime = image.mimeType.trim().toLowerCase();
  if (!ALLOWED_MIME.has(mime)) {
    return { ok: false, error: 'Use a JPEG, PNG, or WebP photo of the page.' };
  }
  if (!image.base64 || image.base64.length < MIN_BASE64) {
    return { ok: false, error: 'That photo is too small to read.' };
  }
  if (image.base64.length > MAX_BASE64) {
    return { ok: false, error: 'That photo is too large. Use a picture under 2 MB.' };
  }

  const config = getAiConfig();
  let chat = client;
  if (chat === undefined) {
    if (!config) {
      return { ok: false, error: 'Photo reading is not on. Pick a starter layout or type the lines yourself.' };
    }
    chat = new OpenAI({ apiKey: config.apiKey }) as unknown as ChatClientLike;
  }
  if (!chat) {
    return { ok: false, error: 'Photo reading is not on. Pick a starter layout or type the lines yourself.' };
  }
  const model = config?.extractionModel;
  if (!model) {
    return { ok: false, error: 'Photo reading is not on. Pick a starter layout or type the lines yourself.' };
  }

  try {
    const response = await chat.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: buildProposePictureMapPrompt(kind) },
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: `data:${mime};base64,${image.base64}`, detail: 'high' },
            },
            { type: 'text', text: 'List the labels on this page and what each one should mean.' },
          ],
        },
      ],
      response_format: { type: 'json_object' },
    });
    const parsed = parseProposedPictureMap(response.choices[0]?.message?.content, kind);
    if (!parsed) {
      return { ok: false, error: 'Could not list the lines on that page. Type them, or pick a starter layout.' };
    }
    return { ok: true, template: parsed };
  } catch {
    return { ok: false, error: 'Could not read the photo. Type the lines, or pick a starter layout.' };
  }
}
