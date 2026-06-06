import { ClassificationType } from '@prisma/client';
import { classifyMessage } from '../messageClassifier';
import { isWhatsAppCommand } from '../whatsappCommands';

describe('classifyMessage', () => {
  it('classifies sales messages', () => {
    const result = classifyMessage('Daily sales cash 2100 card 5400');
    expect(result.type).toBe(ClassificationType.STORE_SALES);
    expect(result.confidence).toBeGreaterThan(0.7);
  });

  it('classifies invoice messages', () => {
    const result = classifyMessage('Invoice from HLA vendor');
    expect(result.type).toBe(ClassificationType.INVOICE_EXPENSE);
  });

  it('returns unknown for empty text', () => {
    const result = classifyMessage('');
    expect(result.type).toBe(ClassificationType.UNKNOWN);
  });
});

describe('isWhatsAppCommand', () => {
  it('detects OK command', () => {
    expect(isWhatsAppCommand('OK')).toBe(true);
    expect(isWhatsAppCommand('ok')).toBe(true);
  });

  it('detects FIX with args', () => {
    expect(isWhatsAppCommand('FIX amount 100')).toBe(true);
  });

  it('rejects regular messages', () => {
    expect(isWhatsAppCommand('Sales cash 100')).toBe(false);
  });
});
