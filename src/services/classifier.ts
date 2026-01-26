import { ClassificationType, ClassificationResult } from '../types';
import { logger } from '../utils/logger';

/**
 * Classify message using rule-based patterns first, then AI fallback
 */
export async function classifyMessage(
  messageText: string,
  useAI: boolean = false
): Promise<ClassificationResult> {
  // Rule-based classification
  const ruleResult = classifyByRules(messageText);

  if (ruleResult.confidence >= 0.7) {
    return ruleResult;
  }

  // AI fallback if confidence is low
  if (useAI) {
    return await classifyWithAI(messageText);
  }

  return {
    type: ClassificationType.UNKNOWN,
    confidence: 0.0,
  };
}

function classifyByRules(text: string): ClassificationResult {

  // Order Request patterns
  const orderPatterns = [
    /\b(need|order|please get|out of|bring|restock)\b/i,
    /\b(get|bring|deliver).*\b(carton|pack|case|box)\b/i,
  ];
  if (orderPatterns.some((pattern) => pattern.test(text))) {
    return { type: ClassificationType.ORDER_REQUEST, confidence: 0.8 };
  }

  // Invoice/Expense patterns
  const invoicePatterns = [
    /\b(invoice|inv|paid|bill)\b/i,
    /\b(vendor|supplier)\b/i,
  ];
  if (invoicePatterns.some((pattern) => pattern.test(text))) {
    return { type: ClassificationType.INVOICE_EXPENSE, confidence: 0.75 };
  }

  // Store Sales patterns
  const salesPatterns = [
    /\b(sales|cash|card|close report|daily sales)\b/i,
    /\b(total|inside sales)\b/i,
  ];
  if (salesPatterns.some((pattern) => pattern.test(text))) {
    return { type: ClassificationType.STORE_SALES, confidence: 0.8 };
  }

  // Fuel Sales patterns
  const fuelPatterns = [
    /\b(gallons|fuel|gas|pos fuel|fuel sales)\b/i,
    /\b(fuel gp|fuel gross profit)\b/i,
  ];
  if (fuelPatterns.some((pattern) => pattern.test(text))) {
    return { type: ClassificationType.FUEL_SALES, confidence: 0.85 };
  }

  // Paid-Out patterns
  const paidOutPatterns = [
    /\b(paid out|payout|cash out|refund)\b/i,
    /\b(cash.*out|money.*out)\b/i,
  ];
  if (paidOutPatterns.some((pattern) => pattern.test(text))) {
    return { type: ClassificationType.PAID_OUT, confidence: 0.8 };
  }

  return { type: ClassificationType.UNKNOWN, confidence: 0.0 };
}

async function classifyWithAI(_text: string): Promise<ClassificationResult> {
  // TODO: Implement AI classification using OpenAI
  logger.info('AI classification not yet implemented');
  return { type: ClassificationType.UNKNOWN, confidence: 0.0 };
}

