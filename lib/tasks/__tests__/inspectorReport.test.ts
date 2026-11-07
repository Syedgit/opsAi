import fs from 'fs';
import path from 'path';
import { customTemplate, parseInspectorReport, presetTemplate, proposeFromReport } from '../inspectorReport';
import { TASK_PRESETS, getPreset } from '../presets';
import { predictInspection } from '../inspection';
import { extractPdfText, NotAPdfError } from '../pdfText';
import { REPORT } from './reportFixture';

describe('parseInspectorReport', () => {
  const report = parseInspectorReport(REPORT);

  it('reads the header: when, which cycle, the score and the points', () => {
    expect(report).toMatchObject({ property: '11111: Springfield, NJ', inspectedOn: '2026-10-13', cycle: 4, visit: 1, percent: 80, earned: 450, possible: 570 });
  });

  it('reads the categories that carry points and skips the empty ones', () => {
    expect(report?.categories).toEqual([
      { label: 'Food Safety', earned: 300, possible: 400 },
      { label: 'Proprietary Fresh Food', earned: 100, possible: 100 },
      { label: 'Vault', earned: 50, possible: 70 },
    ]);
  });

  it('finds every failed standard with its criticality, points and what the inspector wrote', () => {
    const byId = Object.fromEntries((report?.findings ?? []).map((f) => [f.standardId, f]));
    expect(Object.keys(byId)).toEqual(['FS5', 'FS1', 'PA1', 'EC9', 'FS24', 'PA2']);
    expect(byId.FS5).toMatchObject({ criticality: 'major', points: 20, comment: 'Open air case does not appear to have a thermometer.', details: ['Thermometer is not present or not working'] });
    expect(byId.PA1).toMatchObject({ criticality: 'minor', points: 3 });
    expect(byId.EC9).toMatchObject({ criticality: 'major', points: 20, comment: null, details: ['Overflowing can by the door'] });
  });

  it('keeps a comment whole when a page break splits it, without the page header', () => {
    const fs1 = report?.findings.find((f) => f.standardId === 'FS1');
    expect(fs1?.comment).toBe('Label printer is broken and nobody wrote dates by hand.');
    expect(fs1?.details).toEqual(['Condiment containers not individually dated']);
  });

  it('does not report standards the store passed', () => {
    expect(report?.findings.map((f) => f.standardId)).not.toContain('PF5');
    expect(report?.findings.map((f) => f.standardId)).not.toContain('FS25');
  });

  it('takes pass/fail and count items only when answered No, and never the sanitizer line', () => {
    const ids = report?.findings.map((f) => f.standardId) ?? [];
    expect(ids).toContain('FS24');
    expect(ids).toContain('PA2');
    expect(ids).not.toContain('PA2a');
    expect(ids).not.toContain('AF1');
    expect(report?.findings.find((f) => f.standardId === 'PA2')?.details).toEqual(['Only 3 unique items available']);
  });

  it('marks repeat findings from the previous inspection', () => {
    expect(report?.findings.filter((f) => f.repeat).map((f) => f.standardId)).toEqual(['PA1']);
  });

  it('knows the store has no fuel pumps', () => {
    expect(report?.hasFuelPumps).toBe(false);
  });

  it('never reads the manager\'s name, email or signature', () => {
    const json = JSON.stringify(report);
    expect(json).not.toMatch(/Pat|example\.com|signature/i);
  });

  it('is not fooled by other documents', () => {
    expect(parseInspectorReport('Invoice 123 total $40')).toBeNull();
    expect(parseInspectorReport('')).toBeNull();
  });

  it('copes with a report where nothing failed', () => {
    const clean = REPORT.slice(0, REPORT.indexOf('Repeat findings')) + '\nDetailed standards\nFood Safety\nStandardId Question Category Points awarded Points possible\nFS25 Delivery temperatures Food Safety 0 0\nAnswer:\nYes\n';
    expect(parseInspectorReport(clean)?.findings).toEqual([]);
  });
});

describe('proposeFromReport', () => {
  const report = parseInspectorReport(REPORT)!;

  it('offers a library task, a custom task, and notes what is already tracked', () => {
    const proposals = proposeFromReport(report, TASK_PRESETS, [{ standardId: 'FS5', active: true }]);
    const kind = Object.fromEntries(proposals.map((p) => [p.standardId, p.kind]));
    expect(kind).toEqual({ FS5: 'tracked', FS1: 'add', PA1: 'add', EC9: 'custom', FS24: 'add', PA2: 'add' });
    expect(proposals.find((p) => p.standardId === 'FS1')).toMatchObject({ presetId: 'fs1-condiments', criticality: 'critical', points: 50 });
    expect(proposals.find((p) => p.standardId === 'EC9')?.title).toBe('Trash cans emptied and lids closed');
  });

  it('does not count an inactive task as tracked', () => {
    const proposals = proposeFromReport(report, TASK_PRESETS, [{ standardId: 'FS5', active: false }]);
    expect(proposals.find((p) => p.standardId === 'FS5')?.kind).toBe('add');
  });

  it('skips fuel-island standards for a store without fuel pumps', () => {
    const withFuel = { ...report, findings: [...report.findings, { standardId: 'EC2', question: 'Fuel islands clean', criticality: null, points: null, comment: null, details: [], repeat: false }] };
    expect(proposeFromReport(withFuel, TASK_PRESETS, []).find((p) => p.standardId === 'EC2')).toMatchObject({ kind: 'skip', note: expect.stringContaining('no fuel pumps') });
  });
});

describe('tasks made from findings', () => {
  const report = parseInspectorReport(REPORT)!;
  const finding = (id: string) => report.findings.find((f) => f.standardId === id)!;

  it('puts the inspector\'s note on a library task without breaking its limits', () => {
    const preset = getPreset('fs5-cold-holding')!;
    const t = presetTemplate(preset, finding('FS5'), report.inspectedOn);
    expect(t.instructions).toContain('Inspector 2026-10-13: Open air case does not appear to have a thermometer.');
    expect(t.instructions?.startsWith(preset.template.instructions ?? '')).toBe(true);
    expect(t.instructions!.length).toBeLessThanOrEqual(500);
    expect(t.maxValue).toBe(40);
    expect(t.standardId).toBe('FS5');
  });

  it('never exceeds the instructions limit, however long the inspector wrote', () => {
    const long = { ...finding('FS5'), comment: 'x'.repeat(400) };
    for (const preset of TASK_PRESETS.filter((p) => p.source === 'report')) {
      expect(presetTemplate(preset, long, '2026-10-13').instructions?.length ?? 0).toBeLessThanOrEqual(500);
    }
  });

  it('builds a valid task from a standard that is not in the library', () => {
    const t = customTemplate(finding('EC9'), report.inspectedOn);
    expect(t).toMatchObject({ title: 'Trash cans emptied and lids closed', standardId: 'EC9', category: 'exterior_cleanliness', criticality: 'major', points: 20, startTime: '09:00', evidence: 'either', active: true });
    expect(t.instructions).toContain('Overflowing can by the door');
  });

  it('gives a very long question a short title', () => {
    const t = customTemplate({ ...finding('EC9'), question: `${'word '.repeat(60)}end` }, null);
    expect(t.title.length).toBeLessThanOrEqual(120);
  });
});

describe('what the inspector found shows up in the mock inspection', () => {
  it('marks last inspection\'s findings, and makes a repeat of one that is failing again', () => {
    const catalog = [
      { standardId: 'FS6', presetId: 'a', title: 'Labels', category: 'food_safety', criticality: 'critical', points: 50 },
      { standardId: 'PB1', presetId: 'b', title: 'Fountain', category: 'proprietary_beverage', criticality: 'critical', points: 50 },
    ];
    const now = new Date('2026-10-26T15:00:00Z');
    const templates = [{ id: 't1', standardId: 'FS6', points: 50, active: true }];
    const runs = [{ templateId: 't1', status: 'MISSED', outcome: null, dueAt: new Date('2026-10-26T12:00:00Z'), localDate: '2026-10-26', lateAfterMinutes: 60 }];
    const p = predictInspection(catalog, templates, runs, now, new Set(['FS6', 'PB1']));
    expect(p.fails[0]).toMatchObject({ standardId: 'FS6', repeat: true, lastFinding: true });
    expect(p.notTracked[0]).toMatchObject({ standardId: 'PB1', lastFinding: true });
  });

  it('counts a standard the store added itself (not in the library)', () => {
    const now = new Date('2026-10-26T15:00:00Z');
    const templates = [{ id: 't9', standardId: 'EC9', points: 20, active: true, title: 'Trash cans', category: 'exterior_cleanliness', criticality: 'major' }];
    const runs = [{ templateId: 't9', status: 'DONE', outcome: 'pass', dueAt: new Date('2026-10-26T12:00:00Z'), localDate: '2026-10-26', lateAfterMinutes: 60 }];
    const p = predictInspection([], templates, runs, now);
    expect(p.passes.map((r) => r.standardId)).toEqual(['EC9']);
    expect(p.percent).toBe(100);
  });
});

describe('extractPdfText', () => {
  it('refuses something that is not a PDF', async () => {
    await expect(extractPdfText(Buffer.from('hello'))).rejects.toBeInstanceOf(NotAPdfError);
    await expect(extractPdfText(Buffer.alloc(0))).rejects.toBeInstanceOf(NotAPdfError);
  });

  it('refuses a damaged PDF without crashing', async () => {
    await expect(extractPdfText(Buffer.from('%PDF-1.4 this is not really a pdf'))).rejects.toBeInstanceOf(NotAPdfError);
  });
});

// The real report is confidential, so it is git-ignored. When it is in the project folder this checks the
// parser against it end to end (PDF bytes in, findings out). Without it this is skipped.
const realReport = fs.readdirSync(path.join(__dirname, '../../..')).find((f) => /^Debrief_Report_.*\.pdf$/.test(f));
(realReport ? describe : describe.skip)('the real 7Clean report', () => {
  it('reads the 11 failed standards worth 306 points and the right score', async () => {
    const text = await extractPdfText(fs.readFileSync(path.join(__dirname, '../../..', realReport as string)));
    const report = parseInspectorReport(text)!;
    expect(report).toMatchObject({ percent: 72.9, earned: 823, possible: 1129, cycle: 4, visit: 1, inspectedOn: '2026-10-13', hasFuelPumps: false });
    const scored = report.findings.filter((f) => f.points !== null);
    expect(scored.map((f) => f.standardId).sort()).toEqual(['FS1', 'FS14', 'FS5', 'FS6', 'PA1', 'PA6', 'PB1', 'PF5', 'PF6', 'PF7', 'V2']);
    expect(scored.reduce((n, f) => n + (f.points ?? 0), 0)).toBe(306);
    expect(report.findings.map((f) => f.standardId)).toEqual(expect.arrayContaining(['FS24', 'PA2']));
    expect(report.findings.filter((f) => f.repeat).map((f) => f.standardId)).toEqual(['PA1']);
    expect(JSON.stringify(report)).not.toMatch(/@7-11|Muhammad|Umar/i);
  }, 30000);
});
