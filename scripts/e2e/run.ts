/**
 * End-to-end case runner.
 *
 *   npm run e2e                      replay every case in samples/cases (free, deterministic, ~seconds)
 *   npm run e2e -- --live            use the real AI model and score how well it reads your samples
 *   npm run e2e -- --live --record   same, and save the model's answers so replay can reuse them
 *   npm run e2e -- --only invoice    only cases whose folder name contains "invoice"
 *   npm run e2e -- --show            print every message and reply, not just failures
 *   npm run e2e -- --dir samples/cases-demo
 *
 * See samples/cases-demo/README.md for how to add a case.
 */
import fs from 'fs';
import path from 'path';
import { PHONES, createWorld, mimeFor, type AiMode } from './world';
import { checkStep } from './expect';
import type { CaseFile, Recordings, Step } from './types';
import { estimateCostUsd, type AiUsageRecord } from '../../lib/understanding/usage';
import { routeIntent } from '../../lib/understanding/intent';

const allUsage: AiUsageRecord[] = [];

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const option = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const LIVE = flag('live');
const RECORD = flag('record');
const SHOW = flag('show');
const STRICT = flag('strict');
const ONLY = option('only');
const DIR = path.resolve(option('dir') ?? 'samples/cases');
const mode: AiMode = LIVE ? 'live' : 'replay';

const out: string[] = [];
function say(line = ''): void {
  console.log(line);
  out.push(line);
}

const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

function indent(text: string, by = '      '): string {
  return text.split('\n').map((l) => by + l).join('\n');
}

function needsAi(step: Step): boolean {
  if (step.noAi || step.tick) return false;
  // Strangers are turned away and forged requests are refused before the AI is ever involved.
  if (step.from === 'stranger' || step.signature === 'bad') return false;
  // Voice notes are ignored completely, so they never need a recorded AI answer.
  if (step.audio) return false;
  if (step.image) return true;
  const text = (step.text ?? '').trim();
  if (!text && !step.textFile) return false;
  if (/^(ok|yes|cancel|no|fix\b|rule\b|help|status|undo)/i.test(text)) return false;
  return routeIntent({ text: step.textFile ? 'file has numbers 1' : text, hasMedia: false }).layer === 'reason';
}

interface CaseResult {
  name: string;
  title: string;
  steps: number;
  passed: number;
  failed: number;
  skipped: number;
  checked: number;
  wrong: number;
  errored: number;
}

async function runCase(world: ReturnType<typeof createWorld>, dir: string): Promise<CaseResult> {
  const name = path.basename(dir);
  const caseFile = JSON.parse(fs.readFileSync(path.join(dir, 'case.json'), 'utf8')) as CaseFile;
  const recordedPath = path.join(dir, 'recorded.json');
  const recordings: Recordings = fs.existsSync(recordedPath) ? (JSON.parse(fs.readFileSync(recordedPath, 'utf8')).steps ?? {}) : {};
  const newRecordings: Recordings = { ...recordings };

  const result: CaseResult = { name, title: caseFile.title, steps: caseFile.steps.length, passed: 0, failed: 0, skipped: 0, checked: 0, wrong: 0, errored: 0 };
  say('');
  say(`■ ${name} — ${caseFile.title}${mode === 'replay' ? dim(' (replay)') : ' (live AI)'}`);
  if (caseFile.why) say(dim(`  ${caseFile.why}`));

  world.reset(caseFile, mode === 'replay' ? recordings : {});

  for (let index = 0; index < caseFile.steps.length; index += 1) {
    const step = caseFile.steps[index];
    const label = `${index + 1}. ${step.name ?? step.text?.slice(0, 40) ?? step.image ?? step.audio ?? 'step'}`;
    const from = step.from ?? 'owner';

    const text = step.textFile ? fs.readFileSync(path.join(dir, step.textFile), 'utf8') : step.text;
    const image = step.image ? { buffer: fs.readFileSync(path.resolve(dir, step.image)), mimeType: mimeFor(step.image) } : undefined;
    const audio = step.audio ? { buffer: fs.readFileSync(path.resolve(dir, step.audio)), mimeType: mimeFor(step.audio) } : undefined;

    if (mode === 'replay' && needsAi(step) && recordings[String(index)] === undefined) {
      result.skipped += 1;
      say(`  ${yellow('○')} ${label} ${yellow('skipped: no recorded AI answer (run with --live --record to capture one)')}`);
      // Later steps depend on this one (e.g. OK after a report), so stop here.
      result.skipped += caseFile.steps.length - index - 1;
      break;
    }

    const errors: string[] = [];
    const realLog = console.log;
    const realInfo = console.info;
    const realWarn = console.warn;
    const realError = console.error;
    console.log = console.info = console.warn = () => undefined;
    console.error = (...a: unknown[]) => {
      errors.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));
    };
    let outcome;
    try {
      outcome = await world.runStep({
        index,
        from,
        text,
        image,
        audio,
        repeat: step.repeat ?? 1,
        badSignature: step.signature === 'bad',
        at: step.at,
        tick: step.tick,
        removeTasks: step.removeTasks,
      });
    } finally {
      console.log = realLog;
      console.info = realInfo;
      console.warn = realWarn;
      console.error = realError;
    }

    if (step.noAi && outcome.missingRecording) {
      result.failed += 1;
      say(`  ${red('✗')} ${label} ${red('the AI was used for a message that should never reach it')}`);
      break;
    }
    if (mode === 'replay' && outcome.missingRecording) {
      result.skipped += 1;
      say(`  ${yellow('○')} ${label} ${yellow('skipped: recording is missing part of what this step needs')}`);
      break;
    }

    allUsage.push(...outcome.usage);
    const aiError = errors.find((e) => e.includes('AI understanding unavailable') || e.includes('Transcription failed'));
    if (mode === 'live' && aiError) {
      // The model could not be reached at all: that is a setup problem, not a reading mistake, so it is not scored.
      result.failed += 1;
      result.errored += 1;
      say(`  ${red('!')} ${label} ${red('AI call failed, not scored')}`);
      say(indent(red(aiError.slice(0, 300))));
      say(indent(yellow('Check OPENAI_API_KEY, that the account has credits (platform.openai.com/settings/organization/billing), and your network.')));
      break;
    }

    if (RECORD && mode === 'live' && outcome.aiRead) newRecordings[String(index)] = outcome.aiRead;

    const verdict = checkStep(step.expect, outcome.actual);
    result.checked += verdict.checked;
    result.wrong += verdict.failures.length;
    const ok = verdict.failures.length === 0;
    if (ok) result.passed += 1;
    else result.failed += 1;

    say(`  ${ok ? green('✓') : red('✗')} ${label} ${dim(`(${verdict.checked} checks)`)}`);
    if (SHOW || !ok) {
      const who = from === 'owner' ? 'OWNER' : from === 'staff' ? 'STAFF' : 'STRANGER';
      const sent = [step.image ? `[photo ${step.image}]` : '', step.audio ? `[voice ${step.audio}]` : '', text ? JSON.stringify(text.length > 300 ? text.slice(0, 300) + '…' : text) : '']
        .filter(Boolean)
        .join(' ');
      say(indent(`${who} → ${sent}`));
      for (const reply of outcome.actual.replies) say(indent(`opsAi ↓\n${indent(reply, '  ')}`));
      for (const post of outcome.actual.groupPosts) say(indent(`opsAi → group ↓\n${indent(post, '  ')}`));
      if (outcome.actual.replies.length === 0 && outcome.actual.groupPosts.length === 0) say(indent(dim('(no reply)')));
      if (SHOW && outcome.aiRead?.reading !== undefined) say(indent(dim(`AI read: ${JSON.stringify(outcome.aiRead.reading)}`)));
      if (SHOW && outcome.aiRead?.transcript) say(indent(dim(`AI heard: ${JSON.stringify(outcome.aiRead.transcript)}`)));
    }
    if (!ok) {
      for (const failure of verdict.failures) say(indent(red(`✗ ${failure}`)));
      for (const e of errors.slice(0, 3)) say(indent(dim(`log: ${e.slice(0, 300)}`)));
    }
  }

  if (RECORD && mode === 'live') {
    fs.writeFileSync(
      recordedPath,
      JSON.stringify({ _note: 'What the AI answered on a live run. Used by replay mode. Re-record with: npm run e2e -- --live --record', recordedAt: new Date().toISOString(), steps: newRecordings }, null, 2) + '\n'
    );
    say(dim(`  recorded AI answers → ${path.relative(process.cwd(), recordedPath)}`));
  }
  return result;
}

async function main(): Promise<void> {
  if (LIVE && !process.env.OPENAI_API_KEY) {
    console.error('Live mode needs OPENAI_API_KEY in .env (and credits on the OpenAI account).');
    process.exit(2);
  }
  if (!LIVE) process.env.OPENAI_API_KEY = 'replay';

  if (!fs.existsSync(DIR)) {
    console.error(`No cases folder at ${path.relative(process.cwd(), DIR)}.`);
    console.error('Try the built-in examples:  npm run e2e -- --dir samples/cases-demo');
    process.exit(2);
  }
  const dirs = fs
    .readdirSync(DIR)
    .map((n) => path.join(DIR, n))
    .filter((d) => fs.statSync(d).isDirectory() && fs.existsSync(path.join(d, 'case.json')))
    .filter((d) => !ONLY || path.basename(d).includes(ONLY))
    .sort();
  if (dirs.length === 0) {
    console.error(`No cases found in ${path.relative(process.cwd(), DIR)}${ONLY ? ` matching "${ONLY}"` : ''}.`);
    process.exit(2);
  }

  say(`opsAi end-to-end — ${LIVE ? 'LIVE AI: ' + process.env.OPENAI_EXTRACTION_MODEL : 'REPLAY of recorded AI answers (pipeline test; model accuracy not tested)'}`);
  say(`cases: ${path.relative(process.cwd(), DIR)}   owner ${PHONES.owner}, staff ${PHONES.staff}`);

  const world = createWorld(mode);
  const results: CaseResult[] = [];
  for (const dir of dirs) {
    try {
      results.push(await runCase(world, dir));
    } catch (error) {
      say(red(`  ✗ case crashed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`));
      results.push({ name: path.basename(dir), title: '', steps: 0, passed: 0, failed: 1, skipped: 0, checked: 0, wrong: 1, errored: 0 });
    }
  }

  const sum = (f: (r: CaseResult) => number) => results.reduce((n, r) => n + f(r), 0);
  const failedCases = results.filter((r) => r.failed > 0);
  const skippedCases = results.filter((r) => r.skipped > 0 && r.failed === 0);
  say('');
  say('────────────────────────────── summary ──────────────────────────────');
  for (const r of results) {
    const mark = r.errored > 0 ? red('! ERROR') : r.failed > 0 ? red('✗ FAIL') : r.skipped > 0 ? yellow('○ SKIP') : green('✓ pass');
    say(`${mark}  ${r.name}  ${dim(`${r.passed}/${r.steps} steps${r.skipped ? `, ${r.skipped} skipped` : ''}`)}`);
  }
  say('');
  say(`${results.length} cases: ${green(`${results.length - failedCases.length - skippedCases.length} passed`)}, ${failedCases.length ? red(`${failedCases.length} failed`) : '0 failed'}, ${skippedCases.length ? yellow(`${skippedCases.length} skipped`) : '0 skipped'}`);
  const checked = sum((r) => r.checked);
  if (checked > 0) {
    const right = checked - sum((r) => r.wrong);
    say(`${LIVE ? 'AI reading accuracy' : 'Checks passed'}: ${right}/${checked} (${((right / checked) * 100).toFixed(1)}%)`);
  }
  if (LIVE && allUsage.length > 0) {
    const calls = allUsage.filter((u) => u.kind === 'extraction');
    const tokensIn = calls.reduce((n, u) => n + (u.inputTokens ?? 0), 0);
    const tokensOut = calls.reduce((n, u) => n + (u.outputTokens ?? 0), 0);
    const costs = calls.map((u) => estimateCostUsd(u));
    const known = costs.filter((c): c is number => c !== null);
    const cost = known.reduce((n, c) => n + c, 0);
    say(`AI cost of this run: ${known.length === calls.length ? '~' : 'at least ~'}$${cost.toFixed(3)} for ${calls.length} reading${calls.length === 1 ? '' : 's'} (${tokensIn} tokens in, ${tokensOut} out)${calls.length ? `, about $${(cost / Math.max(known.length, 1)).toFixed(3)} each` : ''}`);
  }
  if (skippedCases.length) say(yellow('Skipped cases need a recorded AI answer: npm run e2e -- --live --record'));

  fs.mkdirSync(path.join(process.cwd(), 'tmp'), { recursive: true });
  const transcript = path.join(process.cwd(), 'tmp', 'e2e-last-run.txt');
  fs.writeFileSync(transcript, out.join('\n').replace(/\x1b\[[0-9;]*m/g, '') + '\n');
  say(dim(`transcript: ${path.relative(process.cwd(), transcript)}`));

  process.exit(failedCases.length > 0 || (STRICT && skippedCases.length > 0) ? 1 : 0);
}

main().catch((error) => {
  console.error('E2E RUNNER FAILED', error);
  process.exit(2);
});
