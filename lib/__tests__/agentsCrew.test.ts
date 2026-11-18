import { ClassificationType } from '@prisma/client';
import {
  agentForClassification,
  agentForWhatsAppPath,
  agentsBoardPayload,
  isAgentEnabled,
  readStoreAgentsConfig,
  syncAgentsBooksFromAiChat,
  withStoreAgentsUpdate,
} from '../agents/crew';
import { withAiChatEnrollment } from '../aiChatAccess';

describe('agents crew config', () => {
  it('defaults c_store_gas with core on, staff on, books off', () => {
    const cfg = readStoreAgentsConfig(null);
    expect(cfg.pack).toBe('c_store_gas');
    expect(cfg.autonomy).toBe('draft_only');
    expect(cfg.enabled).toEqual({
      close: true,
      finance: true,
      followup: true,
      staff: true,
      books: false,
    });
  });

  it('mirrors books from aiChat.enrolled and keeps core agents on', () => {
    const enrolled = withAiChatEnrollment({ depositRule: null }, true, new Date('2026-11-15T12:00:00.000Z'));
    expect(isAgentEnabled(enrolled, 'books')).toBe(true);
    expect(readStoreAgentsConfig(enrolled).enabled.close).toBe(true);

    const withStaffOff = withStoreAgentsUpdate(enrolled, { staff: false });
    expect(isAgentEnabled(withStaffOff, 'staff')).toBe(false);
    expect(isAgentEnabled(withStaffOff, 'books')).toBe(true);
    expect((withStaffOff.agents as { enabled: { staff: boolean } }).enabled.staff).toBe(false);
  });

  it('set books via agents also updates aiChat.enrolled', () => {
    const on = withStoreAgentsUpdate({}, { books: true }, new Date('2026-11-15T12:00:00.000Z'));
    expect(isAgentEnabled(on, 'books')).toBe(true);
    expect((on.aiChat as { enrolled: boolean }).enrolled).toBe(true);

    const off = withStoreAgentsUpdate(on, { books: false });
    expect(isAgentEnabled(off, 'books')).toBe(false);
    expect((off.aiChat as { enrolled: boolean }).enrolled).toBe(false);
  });

  it('syncAgentsBooksFromAiChat aligns agents.enabled.books', () => {
    const enrolled = withAiChatEnrollment({}, true, new Date('2026-11-15T12:00:00.000Z'));
    const synced = syncAgentsBooksFromAiChat(enrolled);
    expect((synced.agents as { enabled: { books: boolean } }).enabled.books).toBe(true);
  });

  it('board payload exposes catalog and marketing line', () => {
    const board = agentsBoardPayload({});
    expect(board.pack).toBe('c_store_gas');
    expect(board.catalog.map((c) => c.id)).toEqual([
      'close',
      'finance',
      'followup',
      'staff',
      'books',
    ]);
    expect(board.catalog.find((c) => c.id === 'books')?.pricing).toBe('addon');
    expect(board.marketingLine).toMatch(/confirm/i);
    expect(board.supervisor.name).toBe('Riley');
    expect(board.catalog.find((c) => c.id === 'books')?.name).toBe('Quinn');
    expect(board.catalog.find((c) => c.id === 'close')?.role).toBe('Close');
  });
});

describe('agent routing tags', () => {
  it('maps classification types to Close vs Finance', () => {
    expect(agentForClassification(ClassificationType.STORE_SALES)).toBe('close');
    expect(agentForClassification(ClassificationType.FUEL_SALES)).toBe('close');
    expect(agentForClassification(ClassificationType.PAID_OUT)).toBe('close');
    expect(agentForClassification(ClassificationType.INVOICE_EXPENSE)).toBe('finance');
    expect(agentForClassification(ClassificationType.ORDER_REQUEST)).toBe('finance');
  });

  it('maps WhatsApp paths to crew agents', () => {
    expect(agentForWhatsAppPath('ai_chat')).toBe('books');
    expect(agentForWhatsAppPath('task_evidence')).toBe('staff');
    expect(agentForWhatsAppPath('rules', ClassificationType.STORE_SALES)).toBe('close');
    expect(agentForWhatsAppPath('rules', ClassificationType.INVOICE_EXPENSE)).toBe('finance');
    expect(agentForWhatsAppPath('command')).toBe('supervisor');
    expect(agentForWhatsAppPath('chatter')).toBe('supervisor');
    expect(agentForWhatsAppPath('ai')).toBe('close');
  });
});
