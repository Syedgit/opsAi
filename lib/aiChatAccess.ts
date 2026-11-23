/**
 * Admin AI chat — answers must come from confirmed store data.
 * Pro/Premium include books look-ups by plan; Standard needs explicit enroll (legacy).
 * Owners can still opt a store out under Agents → Turn off.
 */

import { ASK_DATA_USD_PER_STORE_PER_MONTH as AI_CHAT_PRICE } from './billing/plans';

export type AiChatState = {
  enrolled: boolean;
  enrolledAt: string | null;
  /** Owner turned books off for this store even though the plan includes it. */
  optedOut: boolean;
};

export const AI_CHAT_USD_PER_STORE_PER_MONTH = AI_CHAT_PRICE;
/** @deprecated Prefer AI_CHAT_USD_PER_STORE_PER_MONTH */
export const ASK_DATA_USD_PER_STORE_PER_MONTH = AI_CHAT_PRICE;

function asProfile(profileJson: unknown): Record<string, unknown> {
  if (profileJson && typeof profileJson === 'object' && !Array.isArray(profileJson)) {
    return profileJson as Record<string, unknown>;
  }
  return {};
}

function readLegacyAskData(profile: Record<string, unknown>): AiChatState | null {
  const raw = profile.askData;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const enrolled = row.enabled === true || row.enrolled === true;
  const enrolledAt = typeof row.enrolledAt === 'string' ? row.enrolledAt : null;
  return { enrolled, enrolledAt: enrolled ? enrolledAt : null, optedOut: false };
}

export function readAiChatState(profileJson: unknown): AiChatState {
  const profile = asProfile(profileJson);
  if (!Object.keys(profile).length) {
    return { enrolled: false, enrolledAt: null, optedOut: false };
  }
  const raw = profile.aiChat;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const row = raw as Record<string, unknown>;
    const enrolled = row.enrolled === true;
    const enrolledAt = typeof row.enrolledAt === 'string' ? row.enrolledAt : null;
    const optedOut = row.optedOut === true || row.disabled === true;
    return { enrolled, enrolledAt: enrolled ? enrolledAt : null, optedOut };
  }
  return readLegacyAskData(profile) || { enrolled: false, enrolledAt: null, optedOut: false };
}

export function withAiChatEnrollment(
  profileJson: unknown,
  enrolled: boolean,
  now = new Date()
): Record<string, unknown> {
  const base = { ...asProfile(profileJson) };
  const prev = readAiChatState(base);
  delete base.askData;
  return {
    ...base,
    aiChat: {
      enrolled,
      enrolledAt: enrolled ? prev.enrolledAt || now.toISOString() : null,
      // Turning off while on Pro/Premium is an explicit opt-out; turning on clears it.
      optedOut: enrolled ? false : true,
    },
  };
}

/**
 * Owners enroll from Store admin in the normal product flow.
 * Optional kill switch: set AI_CHAT_SELF_ENROLL=false to close new enrollments globally.
 */
export function aiChatSelfEnrollAllowed(): boolean {
  const v = (process.env.AI_CHAT_SELF_ENROLL || process.env.ASK_DATA_SELF_ENROLL || '')
    .toLowerCase()
    .trim();
  if (!v) return true;
  return !(v === 'false' || v === '0' || v === 'no' || v === 'off');
}

export function isAiChatEnrolled(profileJson: unknown): boolean {
  return readAiChatState(profileJson).enrolled;
}

export function isAiChatOptedOut(profileJson: unknown): boolean {
  return readAiChatState(profileJson).optedOut;
}

/**
 * Pro/Premium: books chat is on unless the owner opted this store out.
 * Standard (or no plan feature): only when explicitly enrolled.
 */
export function isBooksChatAllowed(
  profileJson: unknown,
  planIncludesBooks: boolean
): boolean {
  if (planIncludesBooks) return !isAiChatOptedOut(profileJson);
  return isAiChatEnrolled(profileJson);
}

/**
 * Ensure profile enrollment matches plan access (for agents.enabled.books sync).
 * Returns null when no write is needed.
 */
export function withBooksAlignedToPlan(
  profileJson: unknown,
  planIncludesBooks: boolean,
  now = new Date()
): Record<string, unknown> | null {
  if (!planIncludesBooks) return null;
  if (isAiChatOptedOut(profileJson)) return null;
  if (isAiChatEnrolled(profileJson)) return null;
  return withAiChatEnrollment(profileJson, true, now);
}
