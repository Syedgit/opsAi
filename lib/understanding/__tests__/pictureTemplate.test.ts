import {
  cleanPictureTemplate,
  describePictureTemplate,
  pictureMapsForPrompt,
  templateFromPreset,
} from '../pictureTemplate';

describe('picture templates', () => {
  it('treats a gas-site notebook as inside shop plus gas, not an order', () => {
    const started = templateFromPreset('notebook_store_sales');
    expect(started?.note).toContain('inside shop');
    expect(started?.fields.map((f) => [f.label, f.purpose])).toEqual([
      ['Store Credit', 'store_credit'],
      ['Store Cash', 'cash'],
      ['Gas', 'fuel'],
      ['ATM / named paid-out', 'payout'],
      ['Total', 'inside_total'],
      ['Net cash', 'day_total'],
      ['product lines (Marlboro, Lava, …)', 'ignore'],
    ]);
  });

  it('has invoice and schedule starters the owner can tweak later', () => {
    expect(templateFromPreset('vendor_invoice')?.kind).toBe('invoice');
    expect(templateFromPreset('shift_schedule')?.kind).toBe('work_schedule');
    expect(templateFromPreset('shift_schedule')?.note).toMatch(/Hours only/i);
  });

  it('starts from the Exxon Store Close preset', () => {
    const started = templateFromPreset('exxon_store_close');
    expect(started?.fields.map((f) => [f.label, f.purpose])).toEqual([
      ['Total Fuel Sales', 'fuel'],
      ['Total Non Fuel Sales', 'store_credit'],
      ['Grand Total Store Sales Reading', 'ignore'],
    ]);
  });

  it('drops empty lines and keeps an owner note', () => {
    const cleaned = cleanPictureTemplate({
      kind: 'daily_close',
      title: '  Denville fuel page  ',
      note: 'Cash is on the next page.',
      fields: [
        { label: 'Total Fuel Sales', purpose: 'fuel' },
        { label: '   ', purpose: 'ignore' },
      ],
    });
    expect(cleaned).toMatchObject({
      title: 'Denville fuel page',
      note: 'Cash is on the next page.',
      fields: [{ label: 'Total Fuel Sales', purpose: 'fuel' }],
    });
    expect(cleaned?.id).toMatch(/^pic_/);
  });

  it('refuses a map with no fields', () => {
    expect(cleanPictureTemplate({ kind: 'daily_close', title: 'Empty', fields: [] })).toBeNull();
  });

  it('writes a prompt the model can follow', () => {
    const started = templateFromPreset('exxon_tender')!;
    const saved = cleanPictureTemplate(started)!;
    const lines = pictureMapsForPrompt([saved]);
    expect(lines[0]).toContain('Cash Acceptor Cash');
    expect(lines[0]).toContain('cashSales');
    expect(lines[0]).toContain('ignore "Credit CRIND"');
    expect(lines[0]).toContain('Owner note:');
    expect(describePictureTemplate(saved)).toContain('Cash Acceptor Cash');
  });
});
