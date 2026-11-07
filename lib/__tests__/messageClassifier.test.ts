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

  it('treats a restock list as an order, not a broken pump', () => {
    expect(classifyMessage('need 10 Marlboro').type).toBe(ClassificationType.ORDER_REQUEST);
    expect(classifyMessage('out of pepsi').type).toBe(ClassificationType.ORDER_REQUEST);
    expect(classifyMessage('pump 3 is out of order').type).not.toBe(ClassificationType.ORDER_REQUEST);
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
