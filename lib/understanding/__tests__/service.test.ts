import type { PrismaClient } from '@prisma/client';
import { understandAndRespond } from '../service';
import { UnderstandingUnavailableError, type MessageUnderstander } from '../extractor';
import type { Understanding } from '../schema';

jest.mock('../../whatsappMessaging', () => ({ sendWhatsAppMessage: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../messageLogService', () => ({ updateMessageLog: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../pendingActionService', () => ({ createPendingAction: jest.fn().mockResolvedValue('action-1') }));
jest.mock('../../whatsappMedia', () => ({
  downloadWhatsAppMedia: jest.fn().mockResolvedValue({ buffer: Buffer.from('abc'), mimeType: 'image/jpeg' }),
}));
jest.mock('../transcribe', () => ({ transcribeAudio: jest.fn() }));

import { sendWhatsAppMessage } from '../../whatsappMessaging';
import { updateMessageLog } from '../../messageLogService';
import { createPendingAction } from '../../pendingActionService';
import { downloadWhatsAppMedia } from '../../whatsappMedia';
import { transcribeAudio } from '../transcribe';

const prisma = {
  pendingActions: { count: jest.fn().mockResolvedValue(3) },
  userDirectory: { findUnique: jest.fn().mockResolvedValue({ role: 'OWNER' }) },
  userStore: { findMany: jest.fn().mockResolvedValue([]) },
  storeConfig: {
    findMany: jest.fn().mockResolvedValue([{ storeId: 'S001', storeName: 'Rockaway', timezone: 'America/New_York' }]),
  },
} as unknown as PrismaClient;

const sales: Understanding = {
  kind: 'daily_close',
  confidence: 0.9,
  needsReview: [],
  reports: [
    {
      storeHint: 'Rockaway',
      reportDate: '2026-10-12',
      cardSales: 334,
      cashSales: 106,
      fuelSales: 1355,
      payouts: [{ label: 'Lays', amount: 142 }],
      reportedDeposit: 1653,
    },
  ],
};

function understander(result: Understanding | Error): MessageUnderstander & { understand: jest.Mock } {
  return {
    understand: jest.fn(async () => {
      if (result instanceof Error) throw result;
      return result;
    }),
  };
}

const base = { messageId: 'wamid.1', phoneE164: '+15550001111', storeId: 'S001', now: new Date('2026-10-12T18:00:00Z') };

beforeEach(() => {
  jest.clearAllMocks();
});

describe('understandAndRespond', () => {
  it('saves a pending entry and replies with the summary for a text message', async () => {
    const ai = understander(sales);
    const outcome = await understandAndRespond(prisma, { ...base, text: 'Rockaway cash 106 card 334 gas 1355', understander: ai });

    expect(outcome).toBe('handled');
    expect(createPendingAction).toHaveBeenCalledTimes(1);
    expect((createPendingAction as jest.Mock).mock.calls[0].slice(1, 5)).toEqual([
      '+15550001111',
      'S001',
      'STORE_SALES',
      expect.objectContaining({ _kind: 'daily_close', card: 334 }),
    ]);
    const reply = (sendWhatsAppMessage as jest.Mock).mock.calls[0][2] as string;
    expect(reply).toContain('Rockaway');
    expect(reply).toContain('Reply OK to save');
    expect(updateMessageLog).toHaveBeenCalledWith(
      prisma,
      'wamid.1',
      expect.objectContaining({ classification: 'DAILY_CLOSE', processed: true })
    );
  });

  it('sends the photo to the AI as base64', async () => {
    const ai = understander(sales);
    await understandAndRespond(prisma, { ...base, text: '', mediaId: 'media-1', mediaType: 'image/jpeg', understander: ai });
    expect(downloadWhatsAppMedia).toHaveBeenCalledWith('media-1');
    expect(ai.understand.mock.calls[0][0].image).toEqual({ base64: Buffer.from('abc').toString('base64'), mimeType: 'image/jpeg' });
  });

  it('transcribes a voice note and tells the sender what was heard', async () => {
    (downloadWhatsAppMedia as jest.Mock).mockResolvedValueOnce({ buffer: Buffer.from('voice'), mimeType: 'audio/ogg; codecs=opus' });
    (transcribeAudio as jest.Mock).mockResolvedValueOnce('Rockaway cash one oh six card three thirty four');
    const ai = understander(sales);

    await understandAndRespond(prisma, { ...base, text: '', mediaId: 'voice-1', mediaType: 'audio', understander: ai });

    expect(ai.understand.mock.calls[0][0].text).toContain('Rockaway cash one oh six');
    expect(ai.understand.mock.calls[0][0].image).toBeUndefined();
    const reply = (sendWhatsAppMessage as jest.Mock).mock.calls[0][2] as string;
    expect(reply.startsWith('🎙️ I heard: "Rockaway cash one oh six')).toBe(true);
  });

  it('says voice is off when transcription is not configured', async () => {
    (downloadWhatsAppMedia as jest.Mock).mockResolvedValueOnce({ buffer: Buffer.from('voice'), mimeType: 'audio/ogg' });
    (transcribeAudio as jest.Mock).mockResolvedValueOnce(null);
    const ai = understander(sales);

    const outcome = await understandAndRespond(prisma, { ...base, text: '', mediaId: 'voice-1', mediaType: 'audio', understander: ai });

    expect(outcome).toBe('handled');
    expect(ai.understand).not.toHaveBeenCalled();
    expect((sendWhatsAppMessage as jest.Mock).mock.calls[0][2]).toContain("Voice notes aren't switched on");
  });

  it('replies immediately to an equipment problem without creating an entry', async () => {
    const ai = understander({
      kind: 'equipment_issue',
      confidence: 0.8,
      needsReview: [],
      issue: {
        equipment: 'Pump 4',
        category: 'fuel_dispenser',
        description: 'Not dispensing',
        severity: 'high',
        questions: [],
      },
    });
    await understandAndRespond(prisma, { ...base, text: 'Pump 4 not working', understander: ai });
    expect(createPendingAction).not.toHaveBeenCalled();
    expect((sendWhatsAppMessage as jest.Mock).mock.calls[0][2]).toContain('Pump 4');
  });

  it('falls back to the rule-based path when the AI is down for a text message', async () => {
    const ai = understander(new UnderstandingUnavailableError('down'));
    const outcome = await understandAndRespond(prisma, { ...base, text: 'cash 100 card 200', understander: ai });
    expect(outcome).toBe('fallback');
    expect(sendWhatsAppMessage).not.toHaveBeenCalled();
  });

  it('asks to resend a photo when the AI is down (the rules cannot read photos)', async () => {
    const ai = understander(new UnderstandingUnavailableError('down'));
    const outcome = await understandAndRespond(prisma, { ...base, text: '', mediaId: 'media-1', mediaType: 'image/jpeg', understander: ai });
    expect(outcome).toBe('handled');
    expect((sendWhatsAppMessage as jest.Mock).mock.calls[0][2]).toContain('send it again');
  });

  it('asks to resend when the media cannot be downloaded', async () => {
    (downloadWhatsAppMedia as jest.Mock).mockRejectedValueOnce(new Error('expired'));
    const ai = understander(sales);
    const outcome = await understandAndRespond(prisma, { ...base, text: '', mediaId: 'media-1', mediaType: 'image/jpeg', understander: ai });
    expect(outcome).toBe('handled');
    expect(ai.understand).not.toHaveBeenCalled();
    expect((sendWhatsAppMessage as jest.Mock).mock.calls[0][2]).toContain("couldn't open");
  });

  it('creates one pending entry per store for a multi-store message, all from the same message id', async () => {
    const multi: Understanding = {
      ...sales,
      reports: [sales.reports[0], { ...sales.reports[0], storeHint: null }],
    } as Understanding;
    await understandAndRespond(prisma, { ...base, text: 'two stores', understander: understander(multi) });
    expect(createPendingAction).toHaveBeenCalledTimes(2);
    const messageIds = (createPendingAction as jest.Mock).mock.calls.map((c) => c[6]);
    expect(messageIds).toEqual(['wamid.1', 'wamid.1']);
  });

  it('warns an owner with several stores when the message names no store', async () => {
    (prisma.storeConfig.findMany as jest.Mock).mockResolvedValueOnce([
      { storeId: 'S001', storeName: 'Rockaway', timezone: 'America/New_York' },
      { storeId: 'S002', storeName: 'Denville', timezone: 'America/New_York' },
    ]);
    const unnamed: Understanding = {
      ...sales,
      reports: [{ ...sales.reports[0], storeHint: null }],
    } as Understanding;
    await understandAndRespond(prisma, { ...base, text: 'cash 100', understander: understander(unnamed) });
    expect((sendWhatsAppMessage as jest.Mock).mock.calls[0][2]).toContain('No store name found');
  });

  it('keeps plain staff on their own store', async () => {
    (prisma.userDirectory.findUnique as jest.Mock).mockResolvedValueOnce({ role: 'STAFF' });
    const ai = understander(sales);
    await understandAndRespond(prisma, { ...base, text: 'cash 100', understander: ai });
    // Staff never look up the owner's other stores.
    expect(prisma.userStore.findMany).not.toHaveBeenCalled();
    expect((sendWhatsAppMessage as jest.Mock).mock.calls[0][2]).not.toContain('No store name found');
  });

  it('welcomes the first report from a store and explains how to correct it', async () => {
    (prisma.pendingActions.count as jest.Mock).mockResolvedValueOnce(0);
    await understandAndRespond(prisma, { ...base, text: 'cash 100', understander: understander(sales) });
    expect((sendWhatsAppMessage as jest.Mock).mock.calls[0][2]).toContain('This is your first report');
  });

  it('does not repeat the welcome once the store has confirmed entries', async () => {
    await understandAndRespond(prisma, { ...base, text: 'cash 100', understander: understander(sales) });
    expect((sendWhatsAppMessage as jest.Mock).mock.calls[0][2]).not.toContain('This is your first report');
  });

  it('lets an owner teach a rule but not plain staff', async () => {
    await understandAndRespond(prisma, { ...base, text: 'x', understander: understander(sales) });
    expect((createPendingAction as jest.Mock).mock.calls[0][4].suggested_deposit_rule).not.toBeNull();

    jest.clearAllMocks();
    (prisma.userDirectory.findUnique as jest.Mock).mockResolvedValueOnce({ role: 'STAFF' });
    await understandAndRespond(prisma, { ...base, text: 'x', understander: understander(sales) });
    expect((createPendingAction as jest.Mock).mock.calls[0][4].suggested_deposit_rule).toBeNull();
  });
});
