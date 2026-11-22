/**
 * Cheap pre-filter used by routeIntent: chatter vs "might be store data".
 * The real decision (code vs one AI read vs execute) lives in intent.ts.
 *
 * Photos always look like data. Typed text only does when it could hold numbers or
 * an equipment problem. "thanks", "👍", and "good morning" never reach a model.
 */

export type AiGate =
  | { useAi: true }
  | {
      useAi: false;
      /** Reply to send, or null to stay quiet (a thumbs-up does not need an answer). */
      reply: string | null;
      classification: 'CHATTER' | 'NO_DATA';
    };

const NUMBER_WORDS =
  /\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|grand)\b/i;

const PROBLEM_WORDS =
  /\b(broken|broke|not working|isn'?t working|won'?t|wont|can'?t|cant|down|leak\w*|error|out of order|stuck|jam\w*|offline|no power|power out|fire|flood\w*|frozen|freez\w*|smell\w*|alarm|issue|problem|fault\w*|dead|crack\w*|spill\w*|clog\w*|overflow\w*|not (?:turning|printing|reading|accepting)|declin\w*)\b/i;

const ORDER_WORDS =
  /\b(restock|order(?:ing)?|please get|bring|out of(?!\s+order)|carton|cartons|cases?\s+of)\b/i;

const ACK = /^(thanks?|thank you|thx|ty|tysm|ok(?:ay)?|k|kk|got it|noted|cool|great|perfect|nice|good|sure|yes|yep|yeah|no|nope|done|fine|alright|will do|sounds good|np|no problem|welcome|you'?re welcome)[.!\s]*$/i;

const GREETING = /^(hi|hii+|hello|hey|yo|good (?:morning|afternoon|evening|night)|gm|morning|evening)\b[\s\w,!.?]{0,25}$/i;

const EMOJI_ONLY = /^[\p{Extended_Pictographic}\p{Emoji_Component}\s]+$/u;

export const GREETING_REPLY = '👋 Hi! Send the day\'s numbers (like: Rockaway cash 298 card 1355 gas 1440), or a photo. Reply HELP for commands.';

export const NO_DATA_REPLY =
  "👍 Nothing to save from that. Send the day's numbers, an invoice, deposit or order photo, or describe an equipment problem. Reply HELP for commands.";

/** Fallback when the caller cannot look up the store/sheet. Prefer whereSavedReply() with store context. */
export const WHERE_SAVED_REPLY =
  '📍 Confirmed entries go to your opsAi dashboard (Daily sales / Invoices for that store). If a Google Sheet is linked under Tools, they are written there too. Reply TODAY for what was saved today, or DASHBOARD for a sign-in link.';

/** "Where did you save", "where is it saved", "saved where?", etc. */
export function isWhereSavedQuestion(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 120) return false;
  return (
    /\bwhere\b[\s\S]{0,40}\b(save[ds]?|saving|stored?|wrote|written|put)\b/i.test(t) ||
    /\b(save[ds]?|stored?|wrote|written)\b[\s\S]{0,40}\bwhere\b/i.test(t) ||
    /\bwhere (is|are|did|does|was|were|do|can) (it|they|that|this|you|the)\b/i.test(t)
  );
}

/** Store-aware answer after OK / when someone asks where an entry went. */
export function whereSavedReply(input: {
  storeName?: string | null;
  sheetConnected?: boolean;
}): string {
  const name = (input.storeName || '').trim() || 'that store';
  const sheet = input.sheetConnected
    ? 'They are also written to the Google Sheet linked under Tools.'
    : 'No Google Sheet is linked yet — connect one under Tools to mirror entries there.';
  return [
    `📍 Confirmed entries for ${name} are on your opsAi dashboard → Daily sales / Invoices.`,
    sheet,
    'Reply TODAY for what was saved today, or DASHBOARD for a sign-in link.',
  ].join('\n');
}

export function decideAiUse(input: { text: string; hasMedia: boolean }): AiGate {
  if (input.hasMedia) return { useAi: true };

  const text = input.text.trim();
  if (!text) return { useAi: true }; // nothing typed: the caller decides what to say

  if (/\d/.test(text) || NUMBER_WORDS.test(text) || PROBLEM_WORDS.test(text) || ORDER_WORDS.test(text)) return { useAi: true };

  if (EMOJI_ONLY.test(text) || ACK.test(text)) return { useAi: false, reply: null, classification: 'CHATTER' };
  if (GREETING.test(text)) return { useAi: false, reply: GREETING_REPLY, classification: 'CHATTER' };
  if (isWhereSavedQuestion(text)) return { useAi: false, reply: WHERE_SAVED_REPLY, classification: 'CHATTER' };

  // Words only, no numbers, no problem: there is nothing to extract.
  return { useAi: false, reply: NO_DATA_REPLY, classification: 'NO_DATA' };
}
