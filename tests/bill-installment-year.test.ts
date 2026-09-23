import test from 'node:test';
import assert from 'node:assert/strict';
import { inferInstallmentPurchaseYear } from '../lib/utils/billUtils';

// A bill's transaction rows print the purchase DD/MM with no year. For an
// installment row the purchase can be many months (and at least one year)
// before the bill, so the "December on a January bill" heuristic is not
// enough: the purchase year is the one that makes this installment's charge
// date (purchase + (current-1) months) land inside the bill's cycle.
//
// Real production case (Caixa VISA, cycle 16/08-15/09, due 25/09/2026):
//   row "19/09 HTM *asimovacademy 12 DE 12 ... 143,20D"
//   purchase 19/09/2025 -> 12th charge 19/08/2026 (inside the cycle).
// inferYear alone returned 2026; the correct purchase year is 2025.

test('inferInstallmentPurchaseYear: a 12/12 row on a Sept-2026 bill was bought in 2025', () => {
  // printed 19/09, current=12, total=12, cycle due 25/09/2026 (closing 15/09/2026)
  const year = inferInstallmentPurchaseYear({
    txMonth: 9,
    installmentCurrent: 12,
    installmentTotal: 12,
    dueMonth: 9,
    dueYear: 2026,
  });
  assert.equal(year, 2025);
});

test('inferInstallmentPurchaseYear: a 1/12 row on the same bill was bought this year', () => {
  const year = inferInstallmentPurchaseYear({
    txMonth: 9,
    installmentCurrent: 1,
    installmentTotal: 12,
    dueMonth: 9,
    dueYear: 2026,
  });
  assert.equal(year, 2026);
});

test('inferInstallmentPurchaseYear: mid-series row whose charge lands in the cycle month', () => {
  // 3/4 printed 20/04 on a bill due in July 2026 -> charge 3 = Apr+2 = Jun 2026,
  // inside the cycle ending July 2026, so the purchase is this year.
  const year = inferInstallmentPurchaseYear({
    txMonth: 4,
    installmentCurrent: 3,
    installmentTotal: 4,
    dueMonth: 7,
    dueYear: 2026,
  });
  assert.equal(year, 2026);
});

test('inferInstallmentPurchaseYear: last installment of a plan bought late prior year', () => {
  // 4/4 printed 20/11 on a bill due in February 2026 -> charge 4 = Nov+3 = Feb 2026,
  // inside the cycle, so the purchase is the most recent November: 2025.
  const year = inferInstallmentPurchaseYear({
    txMonth: 11,
    installmentCurrent: 4,
    installmentTotal: 4,
    dueMonth: 2,
    dueYear: 2026,
  });
  assert.equal(year, 2025);
});

test('inferInstallmentPurchaseYear: December purchase on a January bill stays previous year', () => {
  // 2/12 printed 15/12 on a bill due Jan 2026 -> purchase Dec 2025.
  const year = inferInstallmentPurchaseYear({
    txMonth: 12,
    installmentCurrent: 2,
    installmentTotal: 12,
    dueMonth: 1,
    dueYear: 2026,
  });
  assert.equal(year, 2025);
});

test('inferInstallmentPurchaseYear: long plan backs off more than one year when needed', () => {
  // 24/24 printed 19/09 on a bill due 25/10/2026 -> charge 24 = Sep+23 = Aug 2026,
  // which is still inside the cycle ending Oct 2026, so purchase is 2024 (not 2025).
  const year = inferInstallmentPurchaseYear({
    txMonth: 9,
    installmentCurrent: 24,
    installmentTotal: 24,
    dueMonth: 10,
    dueYear: 2026,
  });
  assert.equal(year, 2024);
});
