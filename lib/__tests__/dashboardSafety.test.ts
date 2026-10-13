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

  it('never shows made-up data', () => {
    expect(html).not.toMatch(/mock=true/);
    expect(html).not.toMatch(/Main Street Store|Highway 101 Store|Downtown Plaza Store/);
  });
});
