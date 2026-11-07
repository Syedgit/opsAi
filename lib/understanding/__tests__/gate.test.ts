import { decideAiUse, GREETING_REPLY, NO_DATA_REPLY } from '../gate';

const text = (t: string) => decideAiUse({ text: t, hasMedia: false });

describe('decideAiUse: what must reach the AI', () => {
  it.each([
    'Rockaway cash 106 card 334 gas 1355',
    'cash 298',
    'deposit 1653',
    '10/12 report',
    'cash three hundred card two fifty',
    'sold about a grand in lottery',
    'pump not working',
    'the ice machine is broken',
    'freezer is down',
    'coffee machine leaking',
    'card reader declined everything today',
    'POS error again',
    'there is a flood in the back',
    'no power in the cooler',
    'restock cigs from HLA',
    'out of pepsi',
  ])('sends "%s" to the AI', (t) => {
    expect(text(t)).toEqual({ useAi: true });
  });

  it('always sends photos and voice notes, even with no words', () => {
    expect(decideAiUse({ text: '', hasMedia: true })).toEqual({ useAi: true });
    expect(decideAiUse({ text: 'thanks', hasMedia: true })).toEqual({ useAi: true });
  });

  it('leaves an empty message to the caller', () => {
    expect(text('   ')).toEqual({ useAi: true });
  });
});

describe('decideAiUse: what never reaches the AI', () => {
  it.each(['thanks', 'Thank you!', 'ok', 'Got it', 'noted.', 'cool', 'yes', 'no', 'done', '👍', '🙏🙏', '😂', '👍 🙏'])(
    'stays quiet for "%s"',
    (t) => {
      expect(text(t)).toEqual({ useAi: false, reply: null, classification: 'CHATTER' });
    }
  );

  it.each(['hi', 'Hello!', 'hey there', 'good morning', 'Good evening everyone'])('greets back for "%s"', (t) => {
    expect(text(t)).toEqual({ useAi: false, reply: GREETING_REPLY, classification: 'CHATTER' });
  });

  it.each(['running late today, see you soon', 'can you call me when you get a chance', 'who is working tomorrow'])(
    'says there is nothing to save for "%s"',
    (t) => {
      expect(text(t)).toEqual({ useAi: false, reply: NO_DATA_REPLY, classification: 'NO_DATA' });
    }
  );
});
