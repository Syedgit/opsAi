/**
 * Thread-scoped last ask — binds short follow-ups (bare dates, "more", "it was about sale")
 * to the previous tool+slots instead of restarting on ops_today/clarify.
 */

import { parseStandingDayHint } from './dayHint';
import { isCrewToolId, type CrewToolId, type ToolSlots } from './tools/catalog';

export type LastAskState = {
  toolId: CrewToolId;
  slots: ToolSlots;
};

type PlanLike = {
  clarity: 'ok' | 'need_slot' | 'clarify' | 'unsupported' | 'not_ai_chat';
  ask: string | null;
  steps: Array<{ toolId: CrewToolId; slots: ToolSlots; purpose: string }>;
};

const DATA_TOOLS = new Set<CrewToolId>([
  'standing_report',
  'open_invoices',
  'invoice_period_summary',
  'missing_closes',
  'staff_schedule',
  'ops_today',
  'list_connectors',
  'list_gmail_rules',
  'create_gmail_rule',
]);

const CONNECTOR_TOOLS = new Set<CrewToolId>([
  'list_connectors',
  'list_gmail_rules',
  'create_gmail_rule',
]);

const FOLLOW_UP_ONLY =
  /^(total|more|and|this month|this week|yes|ok|same|that day|that|it was about sale|about sale)\b/i;

export function parseLastAsk(raw: unknown): LastAskState | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const toolId = typeof obj.toolId === 'string' ? obj.toolId : null;
  if (!toolId || !isCrewToolId(toolId) || !DATA_TOOLS.has(toolId)) return null;
  const slotsRaw = obj.slots && typeof obj.slots === 'object' && !Array.isArray(obj.slots) ? obj.slots : {};
  const s = slotsRaw as Record<string, unknown>;
  const slots: ToolSlots = {
    period:
      s.period === 'week' || s.period === 'month' || s.period === 'custom' ? s.period : null,
    from: typeof s.from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s.from) ? s.from : null,
    to: typeof s.to === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s.to) ? s.to : null,
    vendor: typeof s.vendor === 'string' && s.vendor.trim() ? s.vendor.trim().slice(0, 60) : null,
    status: s.status === 'all' || s.status === 'open' || s.status === 'paid' ? s.status : null,
  };
  return { toolId, slots };
}

export function lastAskFromPlan(plan: PlanLike): LastAskState | null {
  const step = plan.steps[0];
  if (!step || !DATA_TOOLS.has(step.toolId)) return null;
  return { toolId: step.toolId, slots: step.slots || {} };
}

function looksLikeFollowUp(question: string): boolean {
  const q = question.trim();
  if (!q || q.length > 80) return false;
  if (FOLLOW_UP_ONLY.test(q)) return true;
  if (parseStandingDayHint(q) && q.length <= 24) return true;
  if (/^\d{1,2}\/\d{1,2}(\/\d{2,4})?$/.test(q)) return true;
  return false;
}

function withStandingDay(slots: ToolSlots, day: string | null): ToolSlots {
  if (!day) return { ...slots };
  return { ...slots, period: 'custom', from: day, to: day };
}

/** New topic — never glue lastAsk onto these. */
function isNewTopicAsk(question: string): boolean {
  const q = question.toLowerCase();
  return (
    /\bytd\b|\byear\s*[- ]?to\s*[- ]?date\b|\bthis year\b/.test(q) ||
    /\bhow many vendors\b|\bvendors?\s+we\s+have\b|\bpending\s+payment/.test(q) ||
    /\bopen invoices?\b|\bstill owe\b|\bwho worked\b|\bschedule\b/.test(q) ||
    /\banything to follow\b|\bwhat needs attention\b/.test(q)
  );
}

/**
 * If the user is continuing the previous ask, reuse lastAsk tool+slots
 * (with day/period overrides from the new message).
 * Only short follow-ups / bare dates — never a new full question.
 */
export function applyLastAskToPlan<T extends PlanLike>(
  question: string,
  plan: T,
  lastAsk: LastAskState | null | undefined
): T {
  if (!lastAsk || !DATA_TOOLS.has(lastAsk.toolId)) return plan;
  if (isNewTopicAsk(question)) return plan;

  const primary = plan.steps[0]?.toolId;
  const drifted = !primary || primary === 'ops_today' || primary === 'clarify' || primary === 'help_capabilities';
  const follow = looksLikeFollowUp(question);
  const day = parseStandingDayHint(question);
  // Bare date alone, or confirmation like "was it today 11/22?"
  const dateConfirm =
    !!day &&
    (/^(was it|is it|for)\b/i.test(question.trim()) || question.trim().length <= 28);

  if (!follow && !dateConfirm && !(drifted && day && question.trim().length <= 28)) {
    return plan;
  }

  if (lastAsk.toolId === 'standing_report') {
    return {
      ...plan,
      clarity: 'ok',
      ask: null,
      steps: [
        {
          toolId: 'standing_report',
          slots: withStandingDay(lastAsk.slots, day),
          purpose: 'standing',
        },
      ],
    };
  }

  if (lastAsk.toolId === 'open_invoices' || lastAsk.toolId === 'invoice_period_summary') {
    const slots = { ...lastAsk.slots };
    if (/\bopen\b/i.test(question)) slots.status = 'open';
    if (/\bpaid\b/i.test(question)) slots.status = 'paid';
    if (/\bweek\b/i.test(question)) slots.period = 'week';
    if (/\bmonth\b/i.test(question)) slots.period = 'month';
    return {
      ...plan,
      clarity: 'ok',
      ask: null,
      steps: [{ toolId: lastAsk.toolId, slots, purpose: lastAsk.toolId }],
    };
  }

  // After listing connectors/rules, “add another alert” / “yes” → create a Gmail rule.
  if (
    CONNECTOR_TOOLS.has(lastAsk.toolId) &&
    (/\b(add|create|new|another)\b.{0,24}\b(alert|rule)s?\b/i.test(question) ||
      /\bcan (we|i)\s+add\b/i.test(question) ||
      /^(yes|yeah|yep|sure|ok|please)\b/i.test(question.trim()))
  ) {
    return {
      ...plan,
      clarity: 'ok',
      ask: null,
      steps: [{ toolId: 'create_gmail_rule', slots: {}, purpose: 'create_gmail_rule' }],
    };
  }

  if (drifted && follow) {
    return {
      ...plan,
      clarity: 'ok',
      ask: null,
      steps: [
        {
          toolId: lastAsk.toolId,
          slots: { ...lastAsk.slots },
          purpose: lastAsk.toolId,
        },
      ],
    };
  }

  return plan;
}
