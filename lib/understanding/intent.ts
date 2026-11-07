import { ClassificationType } from '@prisma/client';
import { classifyMessage } from '../messageClassifier';
import { extractDataFromText, unusedNumbers } from '../messageExtraction';
import { decideAiUse, GREETING_REPLY, NO_DATA_REPLY } from './gate';

/**
 * Intent → reason (optional) → execute.
 *
 * This is not three AI calls. Code names the goal, AI reads unstructured input at most
 * once, and code always does the side effects (save, remind, alert, OK/FIX).
 */

export type ExecuteAction = 'command' | 'ignore_audio' | 'chatter' | 'no_data' | 'rules';
export type ReasonWhy = 'photo' | 'invoice' | 'order' | 'leftover_numbers' | 'equipment_or_unknown';

export type Intent =
  | { layer: 'execute'; action: 'command' }
  | { layer: 'execute'; action: 'ignore_audio' }
  | { layer: 'execute'; action: 'chatter'; reply: string | null; classification: 'CHATTER' }
  | { layer: 'execute'; action: 'no_data'; reply: string; classification: 'NO_DATA' }
  | {
      layer: 'execute';
      action: 'rules';
      type: ClassificationType;
      fields: Record<string, unknown>;
      confidence: number;
    }
  | { layer: 'reason'; why: ReasonWhy };

export function routeIntent(input: {
  text: string;
  hasMedia: boolean;
  isCommand?: boolean;
  isAudio?: boolean;
}): Intent {
  if (input.isAudio) return { layer: 'execute', action: 'ignore_audio' };
  if (input.isCommand) return { layer: 'execute', action: 'command' };

  // A photo cannot be parsed by the number rules. One AI read (after task-proof handling).
  if (input.hasMedia) return { layer: 'reason', why: 'photo' };

  const text = input.text.trim();
  if (!text) return { layer: 'execute', action: 'no_data', reply: NO_DATA_REPLY, classification: 'NO_DATA' };

  const gate = decideAiUse({ text, hasMedia: false });
  if (!gate.useAi) {
    if (gate.classification === 'CHATTER') {
      return { layer: 'execute', action: 'chatter', reply: gate.reply, classification: 'CHATTER' };
    }
    return {
      layer: 'execute',
      action: 'no_data',
      reply: gate.reply ?? NO_DATA_REPLY,
      classification: 'NO_DATA',
    };
  }

  const classification = classifyMessage(text);
  if (classification.type === ClassificationType.UNKNOWN) {
    return { layer: 'reason', why: 'equipment_or_unknown' };
  }

  // "out of order" is a broken pump/cooler, not a restock list.
  if (/\bout of order\b/i.test(text)) {
    return { layer: 'reason', why: 'equipment_or_unknown' };
  }

  // Bills carry a due date the number rules do not store; AI reads it, code sets the reminder.
  if (classification.type === ClassificationType.INVOICE_EXPENSE) {
    return { layer: 'reason', why: 'invoice' };
  }

  // Order photos/text need a product list and a vendor from the store's signup catalog.
  if (classification.type === ClassificationType.ORDER_REQUEST) {
    return { layer: 'reason', why: 'order' };
  }

  const extraction = extractDataFromText(classification.type, text);
  const leftover = unusedNumbers(classification.type, text, extraction.fields);
  if (leftover.length > 0) {
    // Rules would drop gas, a second store, a deposit, a payout, ...
    return { layer: 'reason', why: 'leftover_numbers' };
  }

  return {
    layer: 'execute',
    action: 'rules',
    type: classification.type,
    fields: extraction.fields,
    confidence: extraction.confidence,
  };
}

export { GREETING_REPLY, NO_DATA_REPLY };
