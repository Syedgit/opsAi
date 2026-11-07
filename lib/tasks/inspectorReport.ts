import { TaskTemplateInputSchema, describeSchedule, type TaskCategory, type TaskTemplateInput } from './schedule';
import type { TaskPreset } from './presets';

/**
 * Reads an inspector's 7Clean "Debrief Report" (the PDF 7-Eleven gives the store after an inspection) and turns
 * what failed into corrective tasks. No AI: the report has a fixed layout, so it is read with plain rules. That
 * costs nothing and gives the same answer every time.
 *
 * Privacy: the report carries the manager's name, email and signature. None of that is read or kept.
 *
 * Built from one real report (October 2026). If 7-Eleven changes the layout, `parseInspectorReport` returns
 * null or finds fewer standards and the owner is told, instead of guessing.
 */

export type ReportCriticality = 'critical' | 'major' | 'minor';

export interface ReportFinding {
  standardId: string;
  question: string;
  /** From the report. Null for pass/fail and count items, which the report does not weigh. */
  criticality: ReportCriticality | null;
  points: number | null;
  /** What the inspector wrote. */
  comment: string | null;
  /** The bullet points under "Findings". */
  details: string[];
  /** Also failed at the previous inspection. */
  repeat: boolean;
}

export interface ReportCategory {
  label: string;
  earned: number;
  possible: number;
}

export interface ParsedReport {
  property: string | null;
  /** "YYYY-MM-DD" */
  inspectedOn: string | null;
  cycle: number | null;
  visit: number | null;
  percent: number | null;
  earned: number | null;
  possible: number | null;
  categories: ReportCategory[];
  findings: ReportFinding[];
  /** The store's answer to "does this store have fuel pumps?", when the report says. */
  hasFuelPumps: boolean | null;
}

const MAX_FINDINGS = 60;

/** The page header and footer and the table heading that repeat on every page. */
function clean(raw: string): string {
  // The first "Actionable standards" / "Detailed standards" mark where those sections start. Later ones are page headings.
  const marked = raw
    .replace('Actionable standards', ' §ACT§ ')
    .replace('Detailed standards', ' §DET§ ');
  const heading = '(?:[A-Z][A-Za-z]+(?: (?:of|[A-Z][A-Za-z]+)){0,2}\\s+)?';
  return marked
    .replace(/\r/g, '')
    .replace(/CONFIDENTIAL AND PROPRIETARY INFORMATION/gi, ' ')
    .replace(/Report Generated:\s*[\d/]+\s*[\d:]+\s*[AP]M\s*Page\s+\d+\s+of\s+\d+/gi, ' ')
    .replace(/--\s*\d+\s+of\s+\d+\s*--/g, ' ')
    .replace(/Actionable standards/g, ' ')
    .replace(new RegExp(`${heading}Touchpoint\\s+Standard ID\\s+Question\\s+Category\\s+Criticality\\s+Points\\s+Earned\\s+Points\\s+Possible`, 'g'), ' ')
    .replace(new RegExp(`${heading}StandardId\\s+Question\\s+Category\\s+Points\\s+awarded\\s+Points\\s+possible`, 'g'), ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const ID_RE = /(?<![A-Za-z0-9_])([A-Z]{1,4}\d{1,3}[a-z]?)(?![A-Za-z0-9])/g;

/** Words of the category cell (the report wraps them across lines: "Proprietar y Fresh"). They trail the text before the next row. */
const CATEGORY_TAIL = /((?:\s+(?:Food|Safety|Proprietary|Proprietar|Fresh|Beverage|Product|Availablity|Availablit|Availability|Interior|Exterior|Cleanliness|Cleanlines|Back|House|Vault|Auto|Fail|General|y|s|of))+)\s*$/;

function stripCategoryTail(text: string): string {
  const m = CATEGORY_TAIL.exec(text);
  if (!m) return text.trim();
  // Only when a real category word is in the run, so a sentence that happens to end in "of" is left alone.
  if (!/\b(?:Food|Safety|Proprietary|Proprietar|Fresh|Beverage|Product|Availablity|Availablit|Availability|Interior|Exterior|Cleanliness|Cleanlines|Back|House|Vault|Auto|Fail|General)\b/.test(m[1])) return text.trim();
  return text.slice(0, m.index).trim();
}

function lastId(window: string): { id: string; index: number } | null {
  let found: { id: string; index: number } | null = null;
  for (const m of window.matchAll(ID_RE)) found = { id: m[1], index: m.index ?? 0 };
  return found;
}

function section(text: string, from: RegExp, to: RegExp[]): string {
  const start = text.search(from);
  if (start < 0) return '';
  let end = text.length;
  for (const stop of to) {
    const at = text.slice(start + 1).search(stop);
    if (at >= 0) end = Math.min(end, start + 1 + at);
  }
  return text.slice(start, end);
}

function commentAndDetails(body: string): { comment: string | null; details: string[] } {
  const text = stripCategoryTail(body);
  const comment = /Comment:\s*([\s\S]*?)(?=\s*Findings:|$)/.exec(text)?.[1]?.trim() || null;
  const findings = /Findings:\s*([\s\S]*)$/.exec(text)?.[1] ?? '';
  const details = findings.split('•').map((s) => s.trim()).filter(Boolean).slice(0, 8);
  return { comment: comment ? comment.slice(0, 400) : null, details: details.map((d) => d.slice(0, 200)) };
}

const CRITICALITY: Record<string, ReportCriticality> = { Critical: 'critical', Major: 'major', Minor: 'minor' };

function toDate(us: string | undefined): string | null {
  const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(us ?? '');
  return m ? `${m[3]}-${m[1]}-${m[2]}` : null;
}

/** Reads the report text. Returns null when it does not look like a 7Clean report. */
export function parseInspectorReport(raw: string): ParsedReport | null {
  const text = clean(raw);
  if (!/7Clean/i.test(text) || !/(Report category summary|§ACT§|§DET§)/.test(text)) return null;

  const percent = /Overall status, score, and composition\s+([\d.]+)\s*%/i.exec(text)?.[1] ?? /\bTotal\s+\d+\s+\d+\s+([\d.]+)\s*%/.exec(text)?.[1];
  const total = /\bTotal\s+(\d+)\s+(\d+)\s+[\d.]+\s*%/.exec(text);

  const summary = section(text, /Report category summary/, [/\bTotal\s+\d+\s+\d+/]);
  const categories: ReportCategory[] = [];
  for (const label of ['Food Safety', 'Proprietary Fresh Food', 'Proprietary Beverage', 'Product Availablity', 'Product Availability', 'Interior Cleanliness', 'Vault', 'Exterior Cleanliness', 'Back of House']) {
    const m = new RegExp(`(?:^|\\s)${label}\\s+(\\d+)\\s+(\\d+)\\s+[\\d.]+%`).exec(summary);
    if (m && Number(m[2]) > 0) categories.push({ label, earned: Number(m[1]), possible: Number(m[2]) });
  }

  const repeatIds = new Set<string>();
  for (const m of section(text, /Repeat findings/, [/§ACT§/, /§DET§/]).matchAll(ID_RE)) repeatIds.add(m[1]);

  const findings: ReportFinding[] = [];
  const seen = new Set<string>();

  // Scored findings: "<ID> <question> <Category> <Critical|Major|Minor> <earned> <possible> Response: No Comment: ... Findings: ..."
  const actionable = section(text, /§ACT§/, [/§DET§/]);
  const markers = [...actionable.matchAll(/(Critical|Major|Minor)\s+(\d+)\s+(\d+)\s+Response:\s*(Yes|No|N\/A)?/g)];
  const placed = markers.map((m, i) => {
    const from = i === 0 ? 0 : (markers[i - 1].index ?? 0) + markers[i - 1][0].length;
    const id = lastId(actionable.slice(from, m.index ?? 0));
    return { m, id, idAt: id ? from + id.index : null };
  });
  placed.forEach(({ m, id, idAt }, i) => {
    if (!id || idAt === null || seen.has(id.id) || m[4] === 'Yes' || m[4] === 'N/A') return;
    const next = placed.slice(i + 1).find((p) => p.idAt !== null)?.idAt;
    const body = actionable.slice((m.index ?? 0) + m[0].length, next ?? actionable.length);
    const question = stripCategoryTail(actionable.slice(idAt + id.id.length, m.index ?? 0));
    const { comment, details } = commentAndDetails(body);
    const crit = CRITICALITY[m[1]];
    const possible = Number(m[3]);
    seen.add(id.id);
    findings.push({ standardId: id.id, question: question.slice(0, 400), criticality: crit, points: Number.isFinite(possible) ? possible : null, comment, details, repeat: repeatIds.has(id.id) });
  });

  // Pass/fail and count items ("Detailed standards"): the report does not weigh them. Only a "No" is a finding.
  const detailed = section(text, /§DET§/, [/POSITIVE FEEDBACK/, /Manager name/]);
  const answers = [...detailed.matchAll(/Answer:/g)];
  const dmark = answers.map((a, i) => {
    const from = i === 0 ? 0 : (answers[i - 1].index ?? 0) + 'Answer:'.length;
    const at = a.index ?? 0;
    const window = detailed.slice(Math.max(from, at - 600), at);
    const id = lastId(window);
    const idAt = id ? Math.max(from, at - 600) + id.index : null;
    const after = detailed.slice(at + 'Answer:'.length, at + 'Answer:'.length + 40);
    const verdict = /^\s*(Yes|No|N\/A)\b/.exec(after)?.[1] ?? null;
    return { at, id, idAt, verdict };
  });
  dmark.forEach((d, i) => {
    if (!d.id || d.idAt === null || d.verdict !== 'No' || seen.has(d.id.id) || /^(AF|AS)\d/.test(d.id.id)) return;
    const nextBoundary = dmark.slice(i + 1).map((n) => n.idAt ?? n.at).find((n) => n > d.at) ?? detailed.length;
    const body = detailed.slice(d.at + 'Answer:'.length, nextBoundary).replace(/^\s*No\b/, '');
    const question = stripCategoryTail(detailed.slice(d.idAt + d.id.id.length, d.at).replace(/\s+\d+\s+\d+\s*$/, ''));
    const { details } = commentAndDetails(body);
    seen.add(d.id.id);
    findings.push({ standardId: d.id.id, question: question.slice(0, 400), criticality: null, points: null, comment: null, details, repeat: repeatIds.has(d.id.id) });
  });

  const fuel = /fuel pumps\?\s+(?:General\s+)?\d*\s*\d*\s*Answer:\s*(Yes|No)\b/i.exec(text)?.[1];

  return {
    property: /Property Name\s+(.+?)\s+(?:Location\b|Brand\b)/.exec(text)?.[1]?.trim().slice(0, 120) ?? null,
    inspectedOn: toDate(/Start Date Time\s+([\d/]+)/.exec(text)?.[1]) ?? toDate(/7Clean\s+([\d/]+)/.exec(text)?.[1]),
    cycle: numberOrNull(/\bCycle\s+(\d+)\s+Visit\s+(\d+)/.exec(text)?.[1]),
    visit: numberOrNull(/\bCycle\s+(\d+)\s+Visit\s+(\d+)/.exec(text)?.[2]),
    percent: percent === undefined ? null : Number(percent),
    earned: total ? Number(total[1]) : null,
    possible: total ? Number(total[2]) : null,
    categories,
    findings: findings.slice(0, MAX_FINDINGS),
    hasFuelPumps: fuel ? fuel.toLowerCase() === 'yes' : null,
  };
}

function numberOrNull(v: string | undefined): number | null {
  return v === undefined || v === '' ? null : Number(v);
}

/* ------------------------------------------------------------------------------------------------ */

export type ProposalKind =
  /** In the starter library and not tracked yet: add it, with the inspector's note on it. */
  | 'add'
  /** Not in the library: add a task made from the report's own wording. */
  | 'custom'
  /** The store already tracks it. Nothing to add, but the inspection still found it. */
  | 'tracked'
  /** Does not apply to this store. */
  | 'skip';

export interface Proposal {
  standardId: string;
  kind: ProposalKind;
  title: string;
  criticality: ReportCriticality | null;
  points: number | null;
  comment: string | null;
  details: string[];
  repeat: boolean;
  /** For "add": the starter task. */
  presetId: string | null;
  scheduleText: string | null;
  /** Why it is skipped, or what to check when it is already tracked. */
  note: string | null;
}

const PREFIX_CATEGORY: Array<[RegExp, TaskCategory]> = [
  [/^(FS|AF|AS)\d/, 'food_safety'],
  [/^PF\d/, 'proprietary_fresh'],
  [/^PB\d/, 'proprietary_beverage'],
  [/^PA\d/, 'product_availability'],
  [/^IC\d/, 'interior_cleanliness'],
  [/^EC\d/, 'exterior_cleanliness'],
  [/^V\d/, 'vault'],
  [/^BOH\d/, 'back_of_house'],
];

function categoryOf(standardId: string): TaskCategory {
  return PREFIX_CATEGORY.find(([re]) => re.test(standardId))?.[1] ?? 'other';
}

export interface ExistingTemplate {
  standardId: string | null;
  active: boolean;
}

/** What to do about each thing the inspector found. Pure. */
export function proposeFromReport(report: ParsedReport, presets: TaskPreset[], templates: ExistingTemplate[]): Proposal[] {
  const library = new Map<string, TaskPreset>();
  for (const p of presets) {
    const id = p.template.standardId;
    if (p.source === 'report' && id && !library.has(id)) library.set(id, p);
  }
  const tracked = new Set(templates.filter((t) => t.active && t.standardId).map((t) => t.standardId as string));

  return report.findings.map((f): Proposal => {
    const preset = library.get(f.standardId);
    const base = { standardId: f.standardId, criticality: f.criticality ?? (preset?.template.criticality as ReportCriticality | null) ?? null, points: f.points ?? preset?.template.points ?? null, comment: f.comment, details: f.details, repeat: f.repeat };
    const title = preset?.template.title ?? shortTitle(f.question, f.standardId);

    if (preset?.requires === 'fuel' && report.hasFuelPumps === false) {
      return { ...base, kind: 'skip', title, presetId: preset.id, scheduleText: null, note: 'The report says this store has no fuel pumps.' };
    }
    if (tracked.has(f.standardId)) {
      return { ...base, kind: 'tracked', title, presetId: preset?.id ?? null, scheduleText: null, note: 'Already tracked, yet the inspector still found it. Check the task is done on time with real proof, and consider making it more frequent.' };
    }
    if (preset) {
      return { ...base, kind: 'add', title, presetId: preset.id, scheduleText: describeSchedule(preset.template), note: null };
    }
    const custom = customTemplate(f, report.inspectedOn);
    return { ...base, kind: 'custom', title, presetId: null, scheduleText: describeSchedule(custom), note: 'Not in the starter list, so this task uses the report\'s own wording. Set its times in Setup.' };
  });
}

function shortTitle(question: string, standardId: string): string {
  const text = question.replace(/\s+/g, ' ').trim();
  const first = text.split(/(?<=[.!?])\s/)[0] || text;
  return (first.length > 100 ? `${first.slice(0, 97)}...` : first) || `Standard ${standardId}`;
}

function inspectorNote(f: Pick<ReportFinding, 'comment' | 'details'>, inspectedOn: string | null): string {
  const text = f.comment || f.details[0] || '';
  if (!text) return '';
  const when = inspectedOn ? ` ${inspectedOn}` : '';
  return `Inspector${when}: ${text}`;
}

/** The task to create for a finding that is not in the starter list. */
export function customTemplate(f: ReportFinding, inspectedOn: string | null): TaskTemplateInput {
  const note = inspectorNote(f, inspectedOn);
  const question = f.question.replace(/\s+/g, ' ').trim();
  return TaskTemplateInputSchema.parse({
    title: shortTitle(question, f.standardId),
    instructions: [question, note].filter(Boolean).join('\n').slice(0, 500),
    category: categoryOf(f.standardId),
    standardId: f.standardId,
    criticality: f.criticality ?? undefined,
    shift: 'From inspection',
    startTime: '09:00',
    evidence: 'either',
  });
}

/** The task to create for a finding that is in the starter list: the starter task, plus what the inspector wrote. */
export function presetTemplate(preset: TaskPreset, f: ReportFinding, inspectedOn: string | null): TaskTemplateInput {
  const note = inspectorNote(f, inspectedOn);
  const base = preset.template.instructions ?? '';
  let instructions = base;
  if (note) {
    const room = 500 - base.length - 1;
    instructions = room >= 30 ? `${base}${base ? '\n' : ''}${note.slice(0, room)}` : base;
  }
  return { ...preset.template, instructions: instructions || null };
}
