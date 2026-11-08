import { hoursDigestMessageId, hoursDigestText, maybeThursdayHoursText, shouldSendHoursDigest, sundayOf } from '../hoursDigest';
import { schedulePayload } from '../plan';
import { summarizeSchedule } from '../schedule';
import { WorkScheduleSchema } from '../schema';

describe('Thursday hours digest', () => {
  it('only sends on Thursday morning or later', () => {
    expect(shouldSendHoursDigest('2026-11-12', 9 * 60)).toBe(true);
    expect(shouldSendHoursDigest('2026-11-12', 8 * 60 + 59)).toBe(false);
    expect(shouldSendHoursDigest('2026-11-08', 12 * 60)).toBe(false);
  });

  it('finds Sunday of that week', () => {
    expect(sundayOf('2026-11-12')).toBe('2026-11-08');
    expect(sundayOf('2026-11-08')).toBe('2026-11-08');
  });

  it('lists each person and the week total, never pay', () => {
    const schedule = WorkScheduleSchema.parse({
      storeHint: null,
      weekStart: '2026-11-08',
      employees: [
        {
          name: 'Maria',
          statedTotalHours: null,
          shifts: [
            { day: 'Mon', date: null, start: '09:00', end: '17:00', breakMinutes: null },
            { day: 'Tue', date: null, start: '09:00', end: '17:00', breakMinutes: null },
          ],
        },
        {
          name: 'Sam',
          statedTotalHours: null,
          shifts: [{ day: 'Thu', date: null, start: '14:00', end: '22:00', breakMinutes: null }],
        },
      ],
    });
    const text = hoursDigestText('Rockaway', schedule);
    expect(text).toContain('Rockaway');
    expect(text).toContain('Maria 16h');
    expect(text).toContain('Sam 8h');
    expect(text).toContain('Total 24h');
    expect(text).not.toMatch(/wage|salary|payroll|hourly/i);
    expect(hoursDigestMessageId('S001', '2026-11-12')).toBe('hours-digest:S001:2026-11-12');
  });

  it('reads the posted week on Thursday after 9am and stays quiet once sent', async () => {
    const schedule = WorkScheduleSchema.parse({
      storeHint: null,
      weekStart: '2026-11-08',
      employees: [
        {
          name: 'Maria',
          statedTotalHours: null,
          shifts: [{ day: 'Mon', date: null, start: '09:00', end: '17:00', breakMinutes: null }],
        },
      ],
    });
    const payload = schedulePayload(schedule, summarizeSchedule(schedule), []);
    const prisma = {
      messageLog: { findUnique: jest.fn().mockResolvedValue(null) },
      pendingActions: { findMany: jest.fn().mockResolvedValue([{ payloadJson: payload }]) },
    };
    const store = { storeId: 'S001', storeName: 'Rockaway', timezone: 'America/New_York', active: true };
    const due = await maybeThursdayHoursText(prisma as never, store, new Date('2026-11-12T14:30:00Z'));
    expect(due?.messageId).toBe('hours-digest:S001:2026-11-12');
    expect(due?.text).toContain('Maria 8h');
    expect(due?.text).toContain('Total 8h');

    prisma.messageLog.findUnique.mockResolvedValue({ messageId: 'hours-digest:S001:2026-11-12' });
    expect(await maybeThursdayHoursText(prisma as never, store, new Date('2026-11-12T14:30:00Z'))).toBeNull();
    expect(await maybeThursdayHoursText(prisma as never, store, new Date('2026-11-08T14:30:00Z'))).toBeNull();
  });

  it('finds a 7-Eleven Friday-start week on Thursday', async () => {
    const schedule = WorkScheduleSchema.parse({
      storeHint: null,
      weekStart: '2026-11-06',
      employees: [
        {
          name: 'Umar',
          statedTotalHours: null,
          shifts: [{ day: 'Fri', date: null, start: '05:45', end: '16:06', breakMinutes: null }],
        },
      ],
    });
    const payload = schedulePayload(schedule, summarizeSchedule(schedule), []);
    const prisma = {
      messageLog: { findUnique: jest.fn().mockResolvedValue(null) },
      pendingActions: { findMany: jest.fn().mockResolvedValue([{ payloadJson: payload }]) },
    };
    const due = await maybeThursdayHoursText(
      prisma as never,
      { storeId: 'S001', storeName: 'Rockaway', timezone: 'America/New_York', active: true },
      new Date('2026-11-12T14:30:00Z')
    );
    expect(due?.text).toContain('Umar');
    expect(due?.text).toContain('Hours only');
  });
});
