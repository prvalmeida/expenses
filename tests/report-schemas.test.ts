import test from 'node:test';
import assert from 'node:assert/strict';
import { dailyDigestQuerySchema, monthForecastQuerySchema } from '../lib/api/schemas/report';

test('month-forecast accepts an empty query and leaves the defaults to the service', () => {
  const parsed = monthForecastQuerySchema.safeParse({});
  assert.equal(parsed.success, true);
  if (!parsed.success) return;
  assert.equal(parsed.data.month, undefined);
  assert.equal(parsed.data.today, undefined);
});

test('month-forecast coerces the query strings and rejects a bad month', () => {
  const parsed = monthForecastQuerySchema.safeParse({
    month: '2026-11',
    today: '2026-11-08',
    savingsGoal: '1500',
    historyMonths: '6',
  });
  assert.equal(parsed.success, true);
  if (!parsed.success) return;
  assert.equal(parsed.data.savingsGoal, 1500);
  assert.equal(parsed.data.historyMonths, 6);

  for (const month of ['2026-13', '2026-1', 'novembro', '2026-00']) {
    assert.equal(monthForecastQuerySchema.safeParse({ month }).success, false, month);
  }
});

test('month-forecast treats a blank number as absent instead of NaN', () => {
  const parsed = monthForecastQuerySchema.safeParse({ savingsGoal: '', historyMonths: '' });
  assert.equal(parsed.success, true);
  if (!parsed.success) return;
  assert.equal(parsed.data.savingsGoal, undefined);
  assert.equal(parsed.data.historyMonths, undefined);
});

test('month-forecast keeps today inside the month it reports', () => {
  assert.equal(
    monthForecastQuerySchema.safeParse({ month: '2026-10', today: '2026-11-01' }).success,
    false
  );
  assert.equal(
    monthForecastQuerySchema.safeParse({ month: '2026-10', today: '2026-10-31' }).success,
    true
  );
  // A today with no month is fine: the service picks the current month.
  assert.equal(monthForecastQuerySchema.safeParse({ today: '2026-10-31' }).success, true);
});

test('month-forecast bounds the history window', () => {
  assert.equal(monthForecastQuerySchema.safeParse({ historyMonths: '0' }).success, false);
  assert.equal(monthForecastQuerySchema.safeParse({ historyMonths: '13' }).success, false);
  assert.equal(monthForecastQuerySchema.safeParse({ historyMonths: '12' }).success, true);
});

test('daily-digest requires an ISO instant and rejects a stale window', () => {
  const recent = new Date(Date.now() - 3_600_000).toISOString();
  assert.equal(dailyDigestQuerySchema.safeParse({ since: recent }).success, true);
  assert.equal(dailyDigestQuerySchema.safeParse({}).success, false);
  assert.equal(dailyDigestQuerySchema.safeParse({ since: '2026-11-08' }).success, false);
  assert.equal(dailyDigestQuerySchema.safeParse({ since: 'ontem' }).success, false);

  const stale = new Date(Date.now() - 40 * 86_400_000).toISOString();
  assert.equal(dailyDigestQuerySchema.safeParse({ since: stale }).success, false);

  // An explicit offset is accepted too — the script sends `toISOString()`, but a
  // human with a -03:00 clock should not be rejected.
  // (Same instant written in -03:00: shift the wall clock back 3h.)
  const offset = new Date(Date.now() - 4 * 3_600_000).toISOString().replace('Z', '-03:00');
  assert.equal(dailyDigestQuerySchema.safeParse({ since: offset }).success, true);
});

test('daily-digest rejects a since in the future, tolerating a little clock skew', () => {
  const skewed = new Date(Date.now() + 60_000).toISOString();
  assert.equal(dailyDigestQuerySchema.safeParse({ since: skewed }).success, true);

  const future = new Date(Date.now() + 3_600_000).toISOString();
  assert.equal(dailyDigestQuerySchema.safeParse({ since: future }).success, false);

  // The classic mistake: a local -03:00 wall clock labelled as UTC is 3h ahead.
  const mislabelled = new Date(Date.now() + 3 * 3_600_000).toISOString();
  assert.equal(dailyDigestQuerySchema.safeParse({ since: mislabelled }).success, false);
});
