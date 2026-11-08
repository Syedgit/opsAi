import { buildProposePictureMapPrompt, parseProposedPictureMap, proposePictureMapFromPhoto } from '../proposePictureMap';
import type { ChatClientLike } from '../extractor';

describe('parseProposedPictureMap', () => {
  it('keeps printed labels and drops unknown purposes to ignore', () => {
    const parsed = parseProposedPictureMap(
      JSON.stringify({
        kind: 'daily_close',
        title: 'Shell shift close',
        note: 'Fuel is Pump Sales. Inside is Merchandise.',
        fields: [
          { label: 'Pump Sales', purpose: 'fuel' },
          { label: 'Gallons', purpose: 'gallons' },
          { label: 'Merchandise', purpose: 'store_credit' },
          { label: 'Mystery total', purpose: 'not_a_purpose' },
        ],
      }),
      'daily_close'
    );
    expect(parsed?.title).toBe('Shell shift close');
    expect(parsed?.fields).toEqual([
      { label: 'Pump Sales', purpose: 'fuel' },
      { label: 'Gallons', purpose: 'gallons' },
      { label: 'Merchandise', purpose: 'store_credit' },
      { label: 'Mystery total', purpose: 'ignore' },
    ]);
  });

  it('forces the requested kind so an invoice photo cannot become a close', () => {
    const parsed = parseProposedPictureMap(
      JSON.stringify({
        kind: 'invoice',
        title: 'Tender page',
        fields: [{ label: 'Cash in drawer', purpose: 'cash' }],
      }),
      'daily_close'
    );
    expect(parsed?.kind).toBe('daily_close');
  });

  it('rejects empty or invalid JSON', () => {
    expect(parseProposedPictureMap('', 'daily_close')).toBeNull();
    expect(parseProposedPictureMap('{', 'daily_close')).toBeNull();
    expect(parseProposedPictureMap(JSON.stringify({ title: 'x', fields: [] }), 'daily_close')).toBeNull();
  });
});

describe('buildProposePictureMapPrompt', () => {
  it('asks for labels, not dollar amounts', () => {
    const prompt = buildProposePictureMapPrompt('daily_close');
    expect(prompt).toContain('Do not copy dollar amounts');
    expect(prompt).toContain('gallons: Fuel gallons');
    expect(prompt).toContain('store_credit');
  });
});

describe('proposePictureMapFromPhoto', () => {
  const tinyJpeg = 'a'.repeat(100);

  it('reads a photo through the chat client', async () => {
    const prevKey = process.env.OPENAI_API_KEY;
    const prevModel = process.env.OPENAI_EXTRACTION_MODEL;
    const prevOff = process.env.AI_UNDERSTANDING;
    process.env.OPENAI_API_KEY = 'k';
    process.env.OPENAI_EXTRACTION_MODEL = 'test-model';
    process.env.AI_UNDERSTANDING = '';
    const client: ChatClientLike = {
      chat: {
        completions: {
          create: jest.fn().mockResolvedValue({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    kind: 'daily_close',
                    title: 'BP close',
                    note: 'Fuel is PRODUCT SALES.',
                    fields: [{ label: 'PRODUCT SALES', purpose: 'fuel' }],
                  }),
                },
              },
            ],
          }),
        },
      },
    };
    try {
      const result = await proposePictureMapFromPhoto(
        { base64: tinyJpeg, mimeType: 'image/jpeg' },
        'daily_close',
        client
      );
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.template.title).toBe('BP close');
    } finally {
      process.env.OPENAI_API_KEY = prevKey;
      process.env.OPENAI_EXTRACTION_MODEL = prevModel;
      process.env.AI_UNDERSTANDING = prevOff;
    }
  });
});
