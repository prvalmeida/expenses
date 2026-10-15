import test from 'node:test';
import assert from 'node:assert/strict';
import { formatBRL, isVoucher, paymentLabel } from '../lib/utils/money';
import { dayHeading, isInMonth, monthLabel, monthName, shiftMonth, shortDate } from '../lib/utils/monthUtils';

// Display rules from the design system: amounts as "R$ 1.234,56", signed amounts with
// "+" and the U+2212 minus, and month/day labels in pt-BR. Pinned here because every
// screen renders through these helpers.

const NBSP = ' ';

test('formatBRL formats pt-BR currency with a no-break space', () => {
  assert.equal(formatBRL(1234.56), `R$${NBSP}1.234,56`);
  assert.equal(formatBRL(0), `R$${NBSP}0,00`);
});

test('formatBRL signs only when asked, and always marks negatives with U+2212', () => {
  assert.equal(formatBRL(6900, { sign: true }), `+R$${NBSP}6.900,00`);
  assert.equal(formatBRL(-312.45, { sign: true }), `−R$${NBSP}312,45`);
  assert.equal(formatBRL(-312.45), `−R$${NBSP}312,45`);
  assert.equal(formatBRL(0, { sign: true }), `R$${NBSP}0,00`);
});

test('paymentLabel and isVoucher cover every payment type', () => {
  assert.equal(paymentLabel('credit'), 'Crédito');
  assert.equal(paymentLabel('meal-voucher'), 'Vale-refeição');
  assert.equal(isVoucher('food-voucher'), true);
  assert.equal(isVoucher('pix'), false);
  assert.equal(isVoucher(undefined), false);
});

test('isInMonth compares the date prefix', () => {
  assert.equal(isInMonth('2026-10-01', '2026-10'), true);
  assert.equal(isInMonth('2026-10-31T23:59:00Z', '2026-10'), true);
  assert.equal(isInMonth('2026-11-01', '2026-10'), false);
  assert.equal(isInMonth(undefined, '2026-10'), false);
  assert.equal(isInMonth('', '2026-10'), false);
});

test('shiftMonth crosses year boundaries both ways', () => {
  assert.equal(shiftMonth('2026-10', 1), '2026-11');
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  assert.equal(shiftMonth('2026-03', -15), '2024-12');
  assert.equal(shiftMonth('2026-03', 0), '2026-03');
});

test('month and day labels are pt-BR', () => {
  assert.equal(monthLabel('2026-10'), 'Outubro 2026');
  assert.equal(monthLabel('2026-03'), 'Março 2026');
  assert.equal(monthName('2026-10'), 'outubro');
  assert.equal(shortDate('2026-10-05'), '05/10');
  assert.equal(dayHeading('2026-10-05'), '5 de outubro');
});
