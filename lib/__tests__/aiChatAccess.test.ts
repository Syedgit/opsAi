import {
  aiChatSelfEnrollAllowed,
  isAiChatEnrolled,
  readAiChatState,
  withAiChatEnrollment,
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
    expect(readAiChatState(null)).toEqual({ enrolled: false, enrolledAt: null });
    expect(isAiChatEnrolled({})).toBe(false);
    const on = withAiChatEnrollment({ depositRule: null }, true, new Date('2026-11-14T12:00:00.000Z'));
    expect(isAiChatEnrolled(on)).toBe(true);
    expect(readAiChatState(on).enrolledAt).toBe('2026-11-14T12:00:00.000Z');
    expect(on.aiChat).toEqual({ enrolled: true, enrolledAt: '2026-11-14T12:00:00.000Z' });
    expect(on.askData).toBeUndefined();
    expect(on.depositRule).toBeNull();
    const off = withAiChatEnrollment(on, false);
    expect(isAiChatEnrolled(off)).toBe(false);
    expect(readAiChatState(off).enrolledAt).toBeNull();
  });

  it('reads legacy askData.enabled as enrolled', () => {
    expect(
      readAiChatState({ askData: { enabled: true, enrolledAt: '2026-11-01T00:00:00.000Z' } })
    ).toEqual({ enrolled: true, enrolledAt: '2026-11-01T00:00:00.000Z' });
  });

  it('gates self-enroll behind AI_CHAT_SELF_ENROLL', () => {
    delete process.env.AI_CHAT_SELF_ENROLL;
    delete process.env.ASK_DATA_SELF_ENROLL;
    expect(aiChatSelfEnrollAllowed()).toBe(false);
    process.env.AI_CHAT_SELF_ENROLL = 'true';
    expect(aiChatSelfEnrollAllowed()).toBe(true);
  });
});
