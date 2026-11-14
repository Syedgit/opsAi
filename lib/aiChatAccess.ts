/**
 * Admin AI chat ("Ask your data") — answers must come from confirmed store data.
 * Enrollment is per store (owner toggle). Billing can gate self-enroll later.
 */

import { ASK_DATA_USD_PER_STORE_PER_MONTH as AI_CHAT_PRICE } from './billing/plans';

export type AiChatState = {
  enrolled: boolean;
  enrolledAt: string | null;
};

export const AI_CHAT_USD_PER_STORE_PER_MONTH = AI_CHAT_PRICE;
/** @deprecated Prefer AI_CHAT_USD_PER_STORE_PER_MONTH */
export const ASK_DATA_USD_PER_STORE_PER_MONTH = AI_CHAT_PRICE;

function readLegacyAskData(profile: Record<string, unknown>): AiChatState | null {
  const raw = profile.askData;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const enrolled = row.enabled === true || row.enrolled === true;
  const enrolledAt = typeof row.enrolledAt === 'string' ? row.enrolledAt : null;
  return { enrolled, enrolledAt: enrolled ? enrolledAt : null };
}

export function readAiChatState(profileJson: unknown): AiChatState {
  if (!profileJson || typeof profileJson !== 'object' || Array.isArray(profileJson)) {
    return { enrolled: false, enrolledAt: null };
  }
  const profile = profileJson as Record<string, unknown>;
  const raw = profile.aiChat;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const row = raw as Record<string, unknown>;
    const enrolled = row.enrolled === true;
    const enrolledAt = typeof row.enrolledAt === 'string' ? row.enrolledAt : null;
    return { enrolled, enrolledAt: enrolled ? enrolledAt : null };
  }
  return readLegacyAskData(profile) || { enrolled: false, enrolledAt: null };
}

export function withAiChatEnrollment(
  profileJson: unknown,
  enrolled: boolean,
  now = new Date()
): Record<string, unknown> {
  const base =
    profileJson && typeof profileJson === 'object' && !Array.isArray(profileJson)
      ? { ...(profileJson as Record<string, unknown>) }
      : {};
  const prev = readAiChatState(base);
  const next = { ...base };
  delete next.askData;
  return {
    ...next,
    aiChat: {
      enrolled,
      enrolledAt: enrolled ? prev.enrolledAt || now.toISOString() : null,
    },
  };
}

/** Owners may self-enroll only when this is on (trial / beta). Paid checkout can replace it later. */
export function aiChatSelfEnrollAllowed(): boolean {
  const v = (process.env.AI_CHAT_SELF_ENROLL || process.env.ASK_DATA_SELF_ENROLL || '')
    .toLowerCase()
    .trim();
  return v === 'true' || v === '1' || v === 'yes';
}

export function isAiChatEnrolled(profileJson: unknown): boolean {
  return readAiChatState(profileJson).enrolled;
}
