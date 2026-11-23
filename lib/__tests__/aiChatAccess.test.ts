import {
  aiChatSelfEnrollAllowed,
  isAiChatEnrolled,
  isBooksChatAllowed,
  readAiChatState,
  withAiChatEnrollment,
  withBooksAlignedToPlan,
} from '../aiChatAccess';

describe('aiChatAccess', () => {
  const originalAi = process.env.AI_CHAT_SELF_ENROLL;
  const originalLegacy = process.env.ASK_DATA_SELF_ENROLL;

  afterEach(() => {
    if (originalAi === undefined) delete process.env.AI_CHAT_SELF_ENROLL;
    else process.env.AI_CHAT_SELF_ENROLL = originalAi;
    if (originalLegacy === undefined) delete process.env.ASK_DATA_SELF_ENROLL;
    else process.env.ASK_DATA_SELF_ENROLL = originalLegacy;
  });

  it('defaults off and stores aiChat.enrolled on the store profile', () => {
    expect(readAiChatState(null)).toEqual({ enrolled: false, enrolledAt: null, optedOut: false });
    expect(isAiChatEnrolled({})).toBe(false);
    const on = withAiChatEnrollment({ depositRule: null }, true, new Date('2026-11-14T12:00:00.000Z'));
    expect(isAiChatEnrolled(on)).toBe(true);
    expect(readAiChatState(on).enrolledAt).toBe('2026-11-14T12:00:00.000Z');
    expect(on.aiChat).toEqual({
      enrolled: true,
      enrolledAt: '2026-11-14T12:00:00.000Z',
      optedOut: false,
    });
    expect(on.askData).toBeUndefined();
    expect(on.depositRule).toBeNull();
    const off = withAiChatEnrollment(on, false);
    expect(isAiChatEnrolled(off)).toBe(false);
    expect(readAiChatState(off).enrolledAt).toBeNull();
    expect(readAiChatState(off).optedOut).toBe(true);
  });

  it('allows books on Pro/Premium without a prior enroll toggle', () => {
    expect(isBooksChatAllowed({}, true)).toBe(true);
    expect(isBooksChatAllowed({}, false)).toBe(false);
    const optedOut = withAiChatEnrollment({}, false);
    expect(isBooksChatAllowed(optedOut, true)).toBe(false);
    const aligned = withBooksAlignedToPlan({}, true, new Date('2026-11-14T12:00:00.000Z'));
    expect(aligned).not.toBeNull();
    expect(isAiChatEnrolled(aligned!)).toBe(true);
    expect(withBooksAlignedToPlan(aligned!, true)).toBeNull();
  });

  it('reads legacy askData.enabled as enrolled', () => {
    expect(
      readAiChatState({ askData: { enabled: true, enrolledAt: '2026-11-01T00:00:00.000Z' } })
    ).toEqual({ enrolled: true, enrolledAt: '2026-11-01T00:00:00.000Z', optedOut: false });
  });

  it('allows owner self-enroll by default; AI_CHAT_SELF_ENROLL=false is a kill switch', () => {
    delete process.env.AI_CHAT_SELF_ENROLL;
    delete process.env.ASK_DATA_SELF_ENROLL;
    expect(aiChatSelfEnrollAllowed()).toBe(true);
    process.env.AI_CHAT_SELF_ENROLL = 'false';
    expect(aiChatSelfEnrollAllowed()).toBe(false);
    process.env.AI_CHAT_SELF_ENROLL = 'true';
    expect(aiChatSelfEnrollAllowed()).toBe(true);
  });
});
