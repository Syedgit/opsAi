/** Calendar day hints from free text (yesterday / today / 11/21 / ISO). */

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function keywordTodayIso(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

export function addIsoDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Parse a calendar day from the message (yesterday / today / 11/21 / 2026-11-21). */
export function parseStandingDayHint(question: string, todayIso = keywordTodayIso()): string | null {
  const q = question.toLowerCase().trim();
  if (/\byesterday\b/.test(q)) return addIsoDays(todayIso, -1);
  if (/\btoday\b/.test(q)) return todayIso;
  const iso = q.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (iso) return iso[1];
  const md = q.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (md) {
    const month = Number(md[1]);
    const day = Number(md[2]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    let year = md[3] ? Number(md[3]) : Number(todayIso.slice(0, 4));
    if (year < 100) year += 2000;
    return `${year}-${pad2(month)}-${pad2(day)}`;
  }
  return null;
}

/** Year-to-date range (Jan 1 → today in store-local approx). */
export function parseYtdRange(question: string, todayIso = keywordTodayIso()): { from: string; to: string } | null {
  const q = question.toLowerCase();
  if (!/\bytd\b|\byear\s*[- ]?to\s*[- ]?date\b|\bthis year\b/.test(q)) return null;
  const year = todayIso.slice(0, 4);
  return { from: `${year}-01-01`, to: todayIso };
}
