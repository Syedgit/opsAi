import {
  cleanPictureTemplate,
  describePictureTemplate,
  pictureMapsForPrompt,
  templateFromPreset,
} from '../pictureTemplate';

describe('picture templates', () => {
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
