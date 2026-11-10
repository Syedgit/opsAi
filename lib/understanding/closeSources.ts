/**
 * A store's day can arrive as typed text (the owner's daily post) and as photos (POS screens,
 * the handwritten sheet). When text is there it is the record; photos only prove it. Without
 * text, the photos are the record. Text that comes later takes over.
 *
 * In the typed post "Gas" is the cash taken at the pumps, so it is checked against the POS
 * cash-acceptor cash, not the POS fuel total (which includes card at the pump).
 */
import type { Check } from './checks';
import { sameAmount } from './checks';
import { looksLikePosScreen, type OpenClose } from './closeMerge';
import type { DailyCloseReport } from './schema';

export type CloseSource = 'text' | 'photo';

function money(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Older closes have one report; a POS screen counts as a photo, anything else as text. */
export function splitSources(open: OpenClose): { text: DailyCloseReport | null; photo: DailyCloseReport | null } {
  if (open.textReport || open.photoReport) return { text: open.textReport ?? null, photo: open.photoReport ?? null };
  return looksLikePosScreen(open.report) ? { text: null, photo: open.report } : { text: open.report, photo: null };
}

/** A second text for the same day corrects the first; blanks keep what was there. */
export function mergeTexts(earlier: DailyCloseReport, later: DailyCloseReport): DailyCloseReport {
  const pick = <T>(a: T | null | undefined, b: T | null | undefined): T | null => (a != null ? a : b ?? null);
  return {
    ...earlier,
    storeHint: pick(later.storeHint, earlier.storeHint),
    reportDate: pick(later.reportDate, earlier.reportDate),
    cardSales: pick(later.cardSales, earlier.cardSales),
    cashSales: pick(later.cashSales, earlier.cashSales),
    storeSalesTotal: pick(later.storeSalesTotal, earlier.storeSalesTotal),
    fuelSales: pick(later.fuelSales, earlier.fuelSales),
    reportedDeposit: pick(later.reportedDeposit, earlier.reportedDeposit),
    reportedDayTotal: pick(later.reportedDayTotal, earlier.reportedDayTotal),
    payouts: later.payouts.length > 0 ? later.payouts : earlier.payouts,
  };
}

/** The money is the text's; photos only add what the text never says (gallons, discounts, register state). */
export function textOverPhoto(text: DailyCloseReport, photo: DailyCloseReport | null): DailyCloseReport {
  return {
    ...text,
    storeHint: text.storeHint ?? photo?.storeHint ?? null,
    reportDate: text.reportDate ?? photo?.reportDate ?? null,
    fuelGallons: text.fuelGallons ?? photo?.fuelGallons ?? null,
    fuelDiscounts: text.fuelDiscounts ?? photo?.fuelDiscounts ?? null,
    periodClosed: text.periodClosed ?? photo?.periodClosed ?? null,
    payouts: text.payouts.length > 0 ? text.payouts : photo?.payouts ?? [],
  };
}

function compare(id: string, what: string, typed: number | null | undefined, seen: number | null | undefined, seenLabel: string): Check | null {
  if (typed == null || seen == null) return null;
  if (sameAmount(typed, seen, 100)) {
    return { id, status: 'pass', message: `${seenLabel} ${money(seen)} matches ${what} ${money(typed)}.` };
  }
  return { id, status: 'warn', message: `${what[0].toUpperCase()}${what.slice(1)}: text says ${money(typed)}, ${seenLabel.toLowerCase()} shows ${money(seen)} — recount?` };
}

/** Photo proof against the typed post. */
export function proofChecks(text: DailyCloseReport, photo: DailyCloseReport, insideFromSheet = false): Check[] {
  const out: Array<Check | null> = [];
  if (looksLikePosScreen(photo)) {
    out.push(compare('proof_gas_cash', 'gas cash', text.fuelSales, photo.cashSales, 'POS cash'));
    if ((photo.storeSalesTotal ?? 0) > 0) out.push(compare('proof_credit', 'store credit', text.cardSales, photo.storeSalesTotal, 'POS non-fuel'));
    else if (insideFromSheet) out.push(compare('proof_credit', 'store credit', text.cardSales, photo.cardSales, 'Sheet credit'));
  } else {
    out.push(compare('proof_credit', 'store credit', text.cardSales, photo.cardSales, 'Sheet credit'));
    out.push(compare('proof_cash', 'store cash', text.cashSales, photo.cashSales, 'Sheet cash'));
    out.push(compare('proof_gas', 'gas', text.fuelSales, photo.fuelSales, 'Sheet gas'));
  }
  return out.filter((c): c is Check => c != null);
}

/** Which of today's typed closes this unnamed sheet belongs to, by its credit and cash. */
export function storeForSheet(sheet: DailyCloseReport, day: string | null, openCloses: OpenClose[] = [], storeIds: string[]): string | null {
  if (looksLikePosScreen(sheet)) return null;
  const card = sheet.cardSales;
  const cash = sheet.cashSales;
  if ((card ?? 0) <= 0 && (cash ?? 0) <= 0) return null;
  const hits = openCloses.filter((open) => {
    if (!storeIds.includes(open.storeId) || (day && open.report.reportDate !== day)) return false;
    const { text } = splitSources(open);
    if (!text) return false;
    const cardOk = card == null || text.cardSales == null || sameAmount(card, text.cardSales, 100);
    const cashOk = cash == null || text.cashSales == null || sameAmount(cash, text.cashSales, 100);
    const anyCompared = (card != null && text.cardSales != null) || (cash != null && text.cashSales != null);
    return cardOk && cashOk && anyCompared;
  });
  const stores = [...new Set(hits.map((h) => h.storeId))];
  return stores.length === 1 ? stores[0] : null;
}
