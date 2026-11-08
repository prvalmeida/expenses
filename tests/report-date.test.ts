import test from 'node:test';
import assert from 'node:assert/strict';
import { lastDayOfMonth, resolveForecastPeriod, todayInReportTimeZone } from '../lib/utils/reportDate';

test('today is read in Brasília, not in the server clock', () => {
  // 01:30 UTC on Nov 1st is still Oct 31st, 22:30 in São Paulo.
  assert.equal(todayInReportTimeZone(new Date('2026-11-01T01:30:00Z')), '2026-10-31');
  assert.equal(todayInReportTimeZone(new Date('2026-11-01T03:30:00Z')), '2026-11-01');
});

test('lastDayOfMonth follows the real month length', () => {
  assert.equal(lastDayOfMonth('2026-02'), '2026-02-28');
  assert.equal(lastDayOfMonth('2028-02'), '2028-02-29');
  assert.equal(lastDayOfMonth('2026-11'), '2026-11-30');
});

test('forecast period: defaults to the current month and day', () => {
  assert.deepEqual(resolveForecastPeriod({}, '2026-11-08'), { month: '2026-11', today: '2026-11-08' });
});

test('forecast period: a past month with no today reports from its last day', () => {
  assert.deepEqual(resolveForecastPeriod({ month: '2026-10' }, '2026-11-02'), {
    month: '2026-10',
    today: '2026-10-31',
  });
});

test('forecast period: a today with no month decides the month', () => {
  assert.deepEqual(resolveForecastPeriod({ today: '2026-01-05' }, '2026-11-08'), {
    month: '2026-01',
    today: '2026-01-05',
  });
});
