import test from 'node:test';
import assert from 'node:assert/strict';
import {
  currentMonth,
  parseMonthParam,
  parseViewModeParam,
  transactionsHref,
} from '../lib/utils/routeParams';

// The month and view mode live in the URL so a refresh or a shared link keeps them. These
// cases pin the grammar the server page parses and the client links build.

test('parseMonthParam accepts YYYY-MM and rejects anything else', () => {
  assert.equal(parseMonthParam('2026-10'), '2026-10');
  assert.equal(parseMonthParam(['2026-01', '2026-02']), '2026-01');
  assert.equal(parseMonthParam(undefined), null);
  assert.equal(parseMonthParam(''), null);
  assert.equal(parseMonthParam('2026-13'), null);
  assert.equal(parseMonthParam('2026-00'), null);
  assert.equal(parseMonthParam('2026-1'), null);
  assert.equal(parseMonthParam('2026-10-01'), null);
});

test('parseViewModeParam maps cashflow to payment and defaults to purchase', () => {
  assert.equal(parseViewModeParam('cashflow'), 'payment');
  assert.equal(parseViewModeParam('purchase'), 'purchase');
  assert.equal(parseViewModeParam('payment'), 'purchase');
  assert.equal(parseViewModeParam(undefined), 'purchase');
});

test('transactionsHref round-trips through the parsers', () => {
  const href = transactionsHref('2026-03', 'payment');
  assert.equal(href, '/transactions?month=2026-03&mode=cashflow');
  const params = new URL(href, 'http://x').searchParams;
  assert.equal(parseMonthParam(params.get('month') ?? undefined), '2026-03');
  assert.equal(parseViewModeParam(params.get('mode') ?? undefined), 'payment');
  assert.equal(transactionsHref('2026-03', 'purchase'), '/transactions?month=2026-03');
});

test('currentMonth zero-pads the local month', () => {
  assert.equal(currentMonth(new Date(2026, 0, 15)), '2026-01');
  assert.equal(currentMonth(new Date(2026, 11, 31)), '2026-12');
});
