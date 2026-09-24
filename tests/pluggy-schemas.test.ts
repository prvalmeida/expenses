import test from 'node:test';
import assert from 'node:assert/strict';
import { updateAccountLinkSchema } from '../lib/api/schemas/pluggy';

// PUT /api/pluggy/accounts is unauthenticated, so the browser's date picker is
// not a guard: a stored impossible start date is sent to Pluggy as `dateFrom`
// on every sync until someone edits it.

const base = { accountId: 'acc-1', kind: 'BANK' as const, enabled: true };

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
}

test('updateAccountLinkSchema: accepts a real date inside the lookback window', () => {
  assert.equal(updateAccountLinkSchema.safeParse({ ...base, connectedAt: daysAgo(10) }).success, true);
});

test('updateAccountLinkSchema: rejects a date that does not exist on the calendar', () => {
  const year = daysAgo(0).slice(0, 4);
  for (const connectedAt of [`${year}-02-31`, `${year}-04-31`, `${year}-13-01`, `${year}-00-10`]) {
    const result = updateAccountLinkSchema.safeParse({ ...base, connectedAt });
    assert.equal(result.success, false, connectedAt);
    // Asserted on the message, not just the failure: depending on today's
    // date some of these also fall outside the lookback bounds.
    assert.ok(result.error.issues.some(i => i.message === 'Data inválida'), connectedAt);
  }
});

test('updateAccountLinkSchema: omitting connectedAt is still allowed', () => {
  assert.equal(updateAccountLinkSchema.safeParse(base).success, true);
});
