import { getLatestPendingAction, getLatestPendingBatch, isAwaitingText } from '../pendingActionService';

describe('isAwaitingText', () => {
  it('is only true when the flag is explicitly true', () => {
    expect(isAwaitingText({ awaiting_text: true })).toBe(true);
    expect(isAwaitingText({ _kind: 'daily_close', cash: 100 })).toBe(false);
    expect(isAwaitingText({ awaiting_text: false })).toBe(false);
    expect(isAwaitingText(null)).toBe(false);
  });
});

describe('getLatestPendingAction', () => {
  it('returns a normal night report even when awaiting_text is absent', async () => {
    const close = {
      actionId: 'close-1',
      phoneE164: '+1555',
      messageIdInbound: 'm1',
      payloadJson: { _kind: 'daily_close', cash: 200 },
      createdAt: new Date('2026-11-13T22:00:00Z'),
    };
    const prisma = {
      pendingActions: {
        findMany: jest.fn().mockResolvedValue([close]),
      },
    };
    const found = await getLatestPendingAction(prisma as never, '+1555');
    expect(found?.actionId).toBe('close-1');
  });

  it('skips photos still waiting for the daily text', async () => {
    const waiting = {
      actionId: 'photo-1',
      messageIdInbound: 'm2',
      payloadJson: { _kind: 'daily_close', awaiting_text: true },
      createdAt: new Date('2026-11-13T23:00:00Z'),
    };
    const close = {
      actionId: 'close-1',
      messageIdInbound: 'm1',
      payloadJson: { _kind: 'daily_close', cash: 200 },
      createdAt: new Date('2026-11-13T22:00:00Z'),
    };
    const prisma = {
      pendingActions: {
        findMany: jest.fn().mockResolvedValue([waiting, close]),
      },
    };
    const found = await getLatestPendingAction(prisma as never, '+1555');
    expect(found?.actionId).toBe('close-1');
  });
});

describe('getLatestPendingBatch', () => {
  it('keeps every confirmable entry from the same message', async () => {
    const a = {
      actionId: 'a',
      messageIdInbound: 'm1',
      payloadJson: { _kind: 'daily_close', cash: 1 },
      createdAt: new Date('2026-11-13T22:00:00Z'),
    };
    const b = {
      actionId: 'b',
      messageIdInbound: 'm1',
      payloadJson: { _kind: 'daily_close', cash: 2 },
      createdAt: new Date('2026-11-13T22:00:01Z'),
    };
    const prisma = {
      pendingActions: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([b, a])
          .mockResolvedValueOnce([a, b]),
      },
    };
    const batch = await getLatestPendingBatch(prisma as never, '+1555');
    expect(batch.map((r) => r.actionId)).toEqual(['a', 'b']);
  });
});
