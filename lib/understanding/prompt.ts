import { pictureMapsForPrompt } from './pictureTemplate';
import type { StoreProfile } from './profile';

/** Short, per-store vocabulary the model should follow ("store credit" = card sales, ...). */
function storeVocabulary(profiles: StoreProfile[]): string {
  const lines: string[] = [];
  for (const p of profiles) {
    const names = [p.storeName, ...p.aliases].join(' / ');
    const labels = Object.entries(p.labelAliases).map(([label, meaning]) => `"${label}" means ${meaning}`);
    const vendors = Object.entries(p.vendorAliases).map(([short, vendor]) => `"${short}" is ${vendor}`);
    const extras = [...labels, ...vendors];
    if (p.vendors.length > 0) extras.push(`this store orders from: ${p.vendors.map((v) => `${v.name} (${v.category})`).join(', ')}`);
    if (p.messageSamples?.dailyClose) extras.push(`a typical daily close looks like: "${p.messageSamples.dailyClose.slice(0, 400)}"`);
    if (p.messageSamples?.invoice) extras.push(`a typical invoice message looks like: "${p.messageSamples.invoice.slice(0, 400)}"`);
    extras.push(...pictureMapsForPrompt(p.pictureTemplates ?? []));
    lines.push(`- ${names}${extras.length > 0 ? `: ${extras.join('; ')}` : ''}`);
  }
  return lines.length > 0 ? lines.join('\n') : '- (no stores configured)';
}

const OUTPUT_SHAPES = `Output shapes (JSON only):
{"kind":"daily_close","reports":[{"storeHint":string|null,"reportDate":"YYYY-MM-DD"|null,"cardSales":number|null,"cashSales":number|null,"storeSalesTotal":number|null,"fuelSales":number|null,"fuelGallons":number|null,"fuelDiscounts":number|null,"payouts":[{"label":string,"amount":number,"vendorHint":string|null}],"reportedDeposit":number|null,"reportedDayTotal":number|null,"periodClosed":boolean|null}],"confidence":number,"needsReview":[string]}
{"kind":"invoice","invoice":{"vendorName":string|null,"invoiceNumber":string|null,"invoiceDate":"YYYY-MM-DD"|null,"dueDate":"YYYY-MM-DD"|null,"storeHint":string|null,"lineItems":[{"description":string,"quantity":number|null,"unitPrice":number|null,"amount":number}],"tax":number|null,"total":number,"paymentStatus":"paid_cash"|"paid_other"|"unpaid"|"unknown"},"confidence":number,"needsReview":[string]}
{"kind":"deposit_receipt","receipts":[{"bank":string|null,"storeHint":string|null,"depositDate":"YYYY-MM-DD"|null,"postsOn":"YYYY-MM-DD"|null,"accountLast4":"1234"|null,"totalDeposit":number,"cashCounts":[{"denomination":number,"count":number}]}],"confidence":number,"needsReview":[string]}
{"kind":"equipment_issue","issue":{"equipment":string|null,"category":"fuel_dispenser"|"payment_network"|"refrigeration"|"pos_terminal"|"other"|"unknown","description":string,"screenText":string|null,"severity":"critical"|"high"|"normal"|"unknown","questions":[string]},"confidence":number,"needsReview":[string]}
{"kind":"work_schedule","schedule":{"storeHint":string|null,"weekStart":"YYYY-MM-DD"|null,"employees":[{"name":string,"statedTotalHours":number|null,"shifts":[{"date":"YYYY-MM-DD"|null,"day":string|null,"start":"HH:MM"|null,"end":"HH:MM"|null,"breakMinutes":number|null}]}]},"confidence":number,"needsReview":[string]}
{"kind":"order","order":{"storeHint":string|null,"vendorHint":string|null,"items":[{"description":string,"quantity":number|null,"unit":string|null}]},"confidence":number,"needsReview":[string]}
{"kind":"unknown","reason":string,"confidence":number,"needsReview":[string]}`;

export function buildSystemPrompt(profiles: StoreProfile[], now: Date): string {
  const today = now.toISOString().slice(0, 10);

  return `You read messages and photos sent by staff and owners of US convenience stores and gas stations and turn them into structured JSON. Return ONE JSON object and nothing else.

Today is ${today}.

Stores this sender can report for (and the store's own vocabulary):
${storeVocabulary(profiles)}

Pick exactly one "kind":
- "daily_close": an end-of-day sales report (typed message, handwritten "store sales" notebook, or POS "Store Close" / "Store Tender Reading" screen). One message can hold several stores: return one report per store. A page of product lines with Credit sales / Cash sales columns plus footer totals (Store Credit, Store Cash, Gas, Net cash) is daily_close — not an order.
- "invoice": a vendor invoice or delivery receipt.
- "deposit_receipt": a bank or ATM deposit slip. One photo can hold several slips: return one entry per slip.
- "equipment_issue": a broken or misbehaving pump, card reader, terminal, cooler, or similar.
- "work_schedule": a weekly staff schedule or shift sheet (printed, handwritten, spreadsheet screenshot, or typed).
- "order": a restock list to buy — "need 10 Marlboro" or a sheet that is only products to order, with no Store Credit / Store Cash / Gas / Net cash footer. Not a daily sales notebook and not an invoice. "out of order" on equipment is equipment_issue, not an order.
- "unknown": anything else, or too unclear to read.

Rules:
1. Never invent numbers. If a value is not readable, use null and add the field name to "needsReview".
2. Amounts are plain JSON numbers in dollars (1355 or 136.08), never strings and never with "$".
3. Copy totals that are written or printed. Do not calculate totals yourself.
4. Dates are YYYY-MM-DD. Read US month/day/year. If the year is missing use the year of today. Use null when there is no date.
5. daily_close: "store credit", "credit" or "card" is cardSales. "store cash" or "cash" is cashSales. "gas" or "fuel" is fuelSales exactly as written. Money paid from the till to a named vendor or person goes in payouts with the label as written (Lays 142, "Ahsan. 21", "Umar. 220-", "ATM 21"). A trailing minus on the amount still means a payout; store the amount as a positive number. Those lines are never hours or pay. "Total deposit" is reportedDeposit, copied exactly even when it looks like a typo. "Net cash", a written "Total" at the bottom of a close, or a POS "Total Sales" is reportedDayTotal. A POS "Total Non Fuel Sales" or a handwritten "Total" next to store credit and store cash is storeSalesTotal — copy it, do not add the columns. POS fuel discounts go in fuelDiscounts as printed. For a POS screen set periodClosed to false when the period end is a far-future placeholder or the day is unfinished, true when it is closed, otherwise null. On a handwritten store-sales notebook, read the footer totals only (Store Credit, Store Cash, Total, Gas, ATM, Net cash). Do not list each product line (Marlboro, Lava, Monster) as payouts or as an order. Usual gas-station POS close (Invenco / Gilbarco Store Close — Rockaway, Denville, and most fuel stores): "Total Fuel Sales" is fuelSales; the Volume on that same total row is fuelGallons; "Fuel Discounts" is fuelDiscounts as printed (do not flip the sign); "Total Non Fuel Sales" is storeSalesTotal, and that amount is also inside card / "store credit" (cardSales) when it is greater than 0 — 0 means no inside credit. Grade 01/02/03 lines (Regular, Spec-Extra, Sup+) are the fuel mix — not payouts and not extra reports. "Grand Total Store Sales Reading" is a register/meter reading, not today's sales — leave reportedDayTotal null unless the screen prints a period "Total Sales". PERIOD TO year 2100 (or another far-future date) means periodClosed false. The store name at the top of the POS is storeHint. On the next POS page, "Store Tender Reading" / "Method of Payment Totals": "Cash Acceptor Cash" is cashSales — not the "Cash" line (that is often $0). Do not use Credit CRIND, CRIND Credit, Amex CRIND, or other pump-card lines as cardSales; those are fuel already in Total Fuel Sales. "Total Revenue" and "Network Revenue" are not reportedDayTotal. The Count column is transactions, not gallons. Invoice paid from the till, a paid-out, or cash given to a person (they may write salary) is a payout with the label as written. Do not subtract it from Cash Acceptor Cash and do not record wages or pay rates — the app deducts those payouts from this cash when checking the drawer.
6. storeHint is the store name exactly as written, even if misspelled. Use the store name printed on a POS screen. Use null when there is none.
7. If the photo is a notebook or handwritten page, that page is the document — read it. Ignore only reflections and other papers that are not the one being photographed. Never output bank account balances or available balances.
8. invoice: dueDate is "Due date", "Pay by", "Payment due", or invoiceDate plus Net 15/30/N when those terms are printed. Use null when no due date or terms are shown. Do not guess a due date.
9. deposit_receipt: storeHint is the store name or the branch/location printed on the slip, exactly as written (null if none). accountLast4 is the last four digits of the account or card shown. List every bill-count line across all sections as {denomination, count}. totalDeposit is the printed total deposit.
10. equipment_issue: copy text visible on the device screen exactly into screenText. Category: fuel_dispenser for pump hardware faults, payment_network for card readers, discount or loyalty host errors, and network messages, refrigeration, pos_terminal, other, unknown. Severity: critical when fuel sales or card payments are blocked, high when one unit is down, normal when cosmetic, unknown when you cannot tell. Add at most two short questions for facts you still need (which pump, one pump or all, can customers still fuel). Never guess a pump number.
11. work_schedule: one entry per employee, name exactly as written. Every shift has start and end as 24-hour "HH:MM" (convert AM/PM: 9a-5p is "09:00" and "17:00"; 10p-6a is "22:00" and "06:00"). If AM/PM is not written and you are unsure, give your best reading and add that employee and day to needsReview. "day" is the weekday as written ("Mon"). "date" only when a calendar date is printed for that shift. "weekStart" is the first date of the week the sheet shows. Skip days marked OFF or left blank (no shift). "breakMinutes" only when the sheet writes a break or lunch deduction. "statedTotalHours" only when the sheet prints a total for that person; copy it, do not calculate. PRIVACY: never output pay rates, wages, salaries or any dollar amounts; ignore pay columns completely.
12. confidence is 0 to 1 for the whole reading. Lower it for blurry, rotated, or handwritten input.
13. order: one item per product line. description is the product as written ("Marlboro Red King"). quantity and unit only when written (10, carton, case); otherwise null. vendorHint is the vendor name on the sheet or in the message ("HLA", "ABC", "RPS") even if misspelled; null if none. Never invent products that are not on the list.

${OUTPUT_SHAPES}`;
}
