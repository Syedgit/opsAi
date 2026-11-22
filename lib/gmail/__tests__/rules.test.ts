import {
  extractEmailAddress,
  matchGmailOwnerRule,
  matchOwnerFrom,
  normalizeNewGmailRule,
  parseGmailOwnerRules,
} from '../rules';
import { matchGmailHitReason } from '../scan';

describe('gmail owner rules', () => {
  it('parses and rejects empty rules', () => {
    expect(parseGmailOwnerRules(null)).toEqual([]);
    expect(parseGmailOwnerRules([{ from: '', contains: '' }])).toEqual([]);
    expect(parseGmailOwnerRules([{ from: 'billing@x.com', label: 'Bill' }])).toEqual([
      expect.objectContaining({
        from: 'billing@x.com',
        contains: null,
        label: 'Bill',
        mode: 'alert',
      }),
    ]);
  });

  it('requires from or contains on create', () => {
    expect(normalizeNewGmailRule({}).ok).toBe(false);
    expect(normalizeNewGmailRule({ from: '@chase.com' }).ok).toBe(true);
  });

  it('matches from address and domain', () => {
    expect(extractEmailAddress('Action Pest <noreply@actionpest.com>')).toBe('noreply@actionpest.com');
    expect(matchOwnerFrom('Action Pest <noreply@actionpest.com>', '@actionpest.com')).toBe(true);
    expect(matchOwnerFrom('noreply@actionpest.com', 'actionpest')).toBe(true);
    expect(matchOwnerFrom('other@x.com', '@actionpest.com')).toBe(false);
  });

  it('ANDs from + contains when both set', () => {
    const rules = parseGmailOwnerRules([
      { id: '1', label: 'Pest visit', from: '@actionpest.com', contains: 'Upcoming Service Appointment' },
    ]);
    expect(
      matchGmailOwnerRule(
        'Action <a@actionpest.com>',
        'Upcoming Service Appointment on Monday',
        'see you then',
        rules
      )
    ).toBe('Pest visit');
    expect(
      matchGmailOwnerRule('Action <a@actionpest.com>', 'Receipt', 'thanks', rules)
    ).toBeNull();
  });

  it('uses owner rules after built-ins', () => {
    const rules = parseGmailOwnerRules([{ id: '1', label: 'Bank', from: '@chase.com' }]);
    expect(matchGmailHitReason('x@y.com', 'Invoice past due', '', rules)).toBe('past_due');
    expect(matchGmailHitReason('alerts@chase.com', 'Daily balance', '', rules)).toBe('Bank');
  });
});
