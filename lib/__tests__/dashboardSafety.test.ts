import fs from 'fs';
import path from 'path';

const html = fs.readFileSync(path.join(__dirname, '../../public/dashboard.html'), 'utf8');

/**
 * Message text and photo contents are written by other people. The dashboard builds HTML strings,
 * so every such value has to go through esc() or it becomes a way to run script in the owner's browser.
 */
describe('dashboard.html', () => {
  it('never puts raw message data into HTML', () => {
    const rawFields = html.match(/\$\{d\.\w+(?: \|\| (?:'[^']*'|0))?\}/g) ?? [];
    expect(rawFields).toEqual([]);
  });

  it('escapes the dangerous characters', () => {
    const fn = html.match(/function esc\(value\) \{[\s\S]*?\n {8}\}/);
    expect(fn).not.toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const esc = new Function(`${fn![0]}; return esc;`)() as (v: unknown) => string;
    expect(esc('<img src=x onerror=alert(1)>')).toBe('&lt;img src=x onerror=alert(1)&gt;');
    expect(esc(`"'&`)).toBe('&quot;&#39;&amp;');
    expect(esc(null)).toBe('');
    expect(esc(42)).toBe('42');
  });

  it('has a Schedule tab that escapes names and never mentions pay', () => {
    expect(html).toContain('data-tab="schedules"');
    expect(html).toContain('sched-grid');
    const fn = html.match(/function renderSchedules\(container, items\) \{[\s\S]*?\n {8}\}\n/);
    expect(fn).not.toBeNull();
    const body = fn![0];
    expect(body).toContain('esc(e.name)');
    expect(body).toContain('esc(week)');
    expect(body).not.toMatch(/wage|salary|payroll|rate|\$/i);
    expect(html).toContain('esc(row.name)');
    expect(html).toContain('sched-shift');
    expect(html).toContain('Weekdays 9–5');
    expect(html).toContain('Every Thursday');
    expect(html).toContain('Sent the hours to your WhatsApp.');
    expect(html).toContain("Posted this week's shifts to the WhatsApp group.");
    expect(html).toContain('1:1 to your registered number');
    expect(html).toContain('AI readings this month');
    expect(html).toContain('This store · no cap');
    expect(html).toContain('Plan and usage');
    expect(html).toContain('id="appBanner"');
    expect(html).toContain("classList.add('is-on')");
    expect(html).not.toContain('document.body.prepend(el)');
    expect(html).not.toMatch(/wage|salary|payroll/i);
  });

  it('never shows made-up data', () => {
    expect(html).not.toMatch(/mock=true/);
    expect(html).not.toMatch(/Main Street Store|Highway 101 Store|Downtown Plaza Store/);
  });

  it('links to the tasks page', () => {
    expect(html).toContain('href="/tasks"');
  });

  it('lists competitor vs our gas prices with escaped station names', () => {
    expect(html).toContain('data-tab="prices"');
    expect(html).toContain('Gas prices');
    expect(html).toContain('fuelMoney');
    expect(html).toContain('esc(d.station');
    expect(html).toContain('esc(whose)');
  });
});

describe('tasks.html', () => {
  const tasks = fs.readFileSync(path.join(__dirname, '../../public/tasks.html'), 'utf8');
  const vercel = fs.readFileSync(path.join(__dirname, '../../vercel.json'), 'utf8');

  it('escapes every value that comes from the server before it goes into HTML', () => {
    // Values that other people write (task titles, proof text) must always pass through esc().
    // confirm() shows plain text, not HTML, so it is not checked.
    const html = tasks.split('\n').filter((line) => !line.includes('confirm(')).join('\n');
    const fields = html.match(/'\s*\+\s*(?:t|r|p|c)\.(?:title|instructions|evidenceText|shift|scheduleText|label)\s*\+\s*'/g) ?? [];
    expect(fields).toEqual([]);
  });

  it('defines esc() with all five characters', () => {
    const fn = tasks.match(/function esc\(value\) \{[\s\S]*?\n {4}\}/);
    expect(fn).not.toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const esc = new Function(`${fn![0]}; return esc;`)() as (v: unknown) => string;
    expect(esc('<script>"\'&')).toBe('&lt;script&gt;&quot;&#39;&amp;');
  });

  it('sets innerHTML only from strings built with esc()', () => {
    const assigns = tasks.match(/innerHTML = [^;]+;/g) ?? [];
    for (const a of assigns) expect(a).not.toMatch(/\b(?:e|err|error)\.message(?!\))/);
  });

  it('has no pay wording', () => {
    expect(tasks).not.toMatch(/wage|salary|payroll/i);
  });

  it('lets the owner teach a picture map without storing the photo', () => {
    expect(tasks).toContain('Document maps');
    expect(tasks).toContain('Save picture map');
    expect(tasks).toContain('we keep the map, not the file');
    expect(tasks).toContain('invoice, or schedule');
  });

  it('is allowed to show proof photos by the content security policy', () => {
    expect(vercel).toMatch(/img-src[^"]*blob:/);
  });
});
