import { ClassificationType } from '@prisma/client';

export interface ClassificationResult {
  type: ClassificationType;
  confidence: number;
}

/**
 * Rule-based classification, used only when AI understanding is not configured or unreachable.
 * Order matters: the most specific phrases are checked first ("paid out" before "paid",
 * "fuel sales" before "sales").
 */
export function classifyMessage(messageText: string): ClassificationResult {
  const text = messageText.trim();
  if (!text) {
    return { type: ClassificationType.UNKNOWN, confidence: 0 };
  }

  const orderPatterns = [/\b(need|order|please get|out of|bring|restock)\b/i];
  if (orderPatterns.some((p) => p.test(text))) {
    return { type: ClassificationType.ORDER_REQUEST, confidence: 0.8 };
  }

  const paidOutPatterns = [/\b(paid out|payout|cash out|refund)\b/i];
  if (paidOutPatterns.some((p) => p.test(text))) {
    return { type: ClassificationType.PAID_OUT, confidence: 0.8 };
  }

  const strongFuelPatterns = [/\b(gallons|pos fuel|fuel sales|gas sales|fuel gp)\b/i];
  if (strongFuelPatterns.some((p) => p.test(text))) {
    return { type: ClassificationType.FUEL_SALES, confidence: 0.85 };
  }

  const invoicePatterns = [/\b(invoice|inv|paid|bill|vendor|supplier)\b/i];
  if (invoicePatterns.some((p) => p.test(text))) {
    return { type: ClassificationType.INVOICE_EXPENSE, confidence: 0.75 };
  }

  const salesPatterns = [/\b(sales|cash|card|close report|daily sales|total|inside sales)\b/i];
  if (salesPatterns.some((p) => p.test(text))) {
    return { type: ClassificationType.STORE_SALES, confidence: 0.8 };
  }

  const fuelPatterns = [/\b(fuel|gas)\b/i];
  if (fuelPatterns.some((p) => p.test(text))) {
    return { type: ClassificationType.FUEL_SALES, confidence: 0.85 };
  }

  return { type: ClassificationType.UNKNOWN, confidence: 0 };
}
