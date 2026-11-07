/**
 * Create a new end-to-end case from a photo, text file, or voice note.
 *
 *   npm run e2e:new -- <case-name> <file> ["caption or typed text"]
 *
 * Examples:
 *   npm run e2e:new -- invoice-sysco ~/Desktop/sysco.jpg
 *   npm run e2e:new -- pump-broken ~/Desktop/pump.jpg "pump 3 not working"
 *   npm run e2e:new -- morning-report ~/Desktop/report.txt
 *   npm run e2e:new -- voice-friday ~/Desktop/note.m4a
 *
 * It copies the file into samples/cases/<case-name>/ and writes a starter case.json.
 * Then run it live once to see what the AI reads:   npm run e2e -- --live --only <case-name> --show
 * Fix the "expect" section to what is TRUE for your file, and run again.
 */
import fs from 'fs';
import path from 'path';

const [, , name, file, text] = process.argv;
if (!name || !file) {
  console.error('Usage: npm run e2e:new -- <case-name> <file> ["caption or typed text"]');
  process.exit(2);
}
if (!/^[a-z0-9][a-z0-9-_]*$/i.test(name)) {
  console.error('Case name: letters, numbers, - and _ only.');
  process.exit(2);
}
const source = path.resolve(file.replace(/^~/, process.env.HOME ?? '~'));
if (!fs.existsSync(source)) {
  console.error(`File not found: ${source}`);
  process.exit(2);
}

const dir = path.join(process.cwd(), 'samples', 'cases', name);
if (fs.existsSync(dir)) {
  console.error(`samples/cases/${name} already exists. Pick another name or delete it.`);
  process.exit(2);
}
fs.mkdirSync(dir, { recursive: true });

const ext = path.extname(source).toLowerCase();
const copied = `input${ext}`;
fs.copyFileSync(source, path.join(dir, copied));

const isImage = ['.png', '.jpg', '.jpeg', '.webp'].includes(ext);
const isAudio = ['.wav', '.mp3', '.m4a', '.ogg', '.opus'].includes(ext);

const step: Record<string, unknown> = { name: 'Owner sends it' };
if (isImage) {
  step.image = copied;
  if (text) step.text = text;
} else if (isAudio) {
  step.audio = copied;
} else {
  step.textFile = copied;
}
step.expect = {
  replyCount: 1,
  status: { PENDING: 1 },
  entries: [{ kind: 'daily_close', store: 'Rockaway', date: 'YYYY-MM-DD', cash: 0, card: 0, fuel: 0 }],
};

const caseFile = {
  title: `TODO describe: ${name}`,
  why: 'TODO what this proves',
  today: new Date().toISOString().slice(0, 10) + 'T12:00:00-04:00',
  steps: [step, { name: 'Owner replies OK', text: 'OK', expect: { status: { PENDING: 0, CONFIRMED: 1 } } }],
};
fs.writeFileSync(path.join(dir, 'case.json'), JSON.stringify(caseFile, null, 2) + '\n');

console.log(`Created samples/cases/${name}/`);
console.log('Next:');
console.log(`  1. npm run e2e -- --live --only ${name} --show     (see what the AI reads; needs OpenAI credits)`);
console.log(`  2. Edit samples/cases/${name}/case.json  → set "expect" to what is true for your file`);
console.log(`     (kind: daily_close | invoice | deposit_receipt; fields: cash card fuel deposit vendor total ...)`);
console.log(`  3. npm run e2e -- --live --record --only ${name}    (saves the AI answer so replay is free from now on)`);
