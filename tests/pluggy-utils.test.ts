import test from 'node:test';
import assert from 'node:assert/strict';
import {
  derivePaymentType,
  deriveDirection,
  deriveInstallments,
  anchorPurchaseDate,
  shouldIgnore,
  PLUGGY_IGNORE_RULES,
} from '../lib/utils/pluggyUtils';

// --- step 8: derivePaymentType, the ladder -------------------------------

test('derivePaymentType: the ladder, first match wins', () => {
  const cases: Array<{
    name: string;
    tx: Parameters<typeof derivePaymentType>[0];
    account: Parameters<typeof derivePaymentType>[1];
    expected: ReturnType<typeof derivePaymentType>;
  }> = [
    {
      name: 'CREDIT account always wins, regardless of paymentMethod',
      tx: { paymentData: { paymentMethod: 'PIX' } },
      account: { kind: 'CREDIT', cardBrand: 'Master Santander' },
      expected: { paymentType: 'credit', cardBrand: 'Master Santander' },
    },
    {
      name: 'CREDIT account with no cardBrand yet configured',
      tx: {},
      account: { kind: 'CREDIT' },
      expected: { paymentType: 'credit', cardBrand: undefined },
    },
    {
      name: 'PIX on a BANK account',
      tx: { paymentData: { paymentMethod: 'PIX' } },
      account: { kind: 'BANK' },
      expected: { paymentType: 'pix' },
    },
    {
      name: 'TED maps to debit — the app has no transfer type',
      tx: { paymentData: { paymentMethod: 'TED' } },
      account: { kind: 'BANK' },
      expected: { paymentType: 'debit' },
    },
    {
      name: 'DOC maps to debit',
      tx: { paymentData: { paymentMethod: 'DOC' } },
      account: { kind: 'BANK' },
      expected: { paymentType: 'debit' },
    },
    {
      name: 'TRANSFER maps to debit',
      tx: { paymentData: { paymentMethod: 'TRANSFER' } },
      account: { kind: 'BANK' },
      expected: { paymentType: 'debit' },
    },
    {
      name: 'BOLETO maps to debit',
      tx: { paymentData: { paymentMethod: 'BOLETO' } },
      account: { kind: 'BANK' },
      expected: { paymentType: 'debit' },
    },
    {
      name: 'unknown paymentMethod falls back to the account default',
      tx: { paymentData: { paymentMethod: 'SOMETHING_ELSE' } },
      account: { kind: 'BANK', defaultPaymentType: 'debit' },
      expected: { paymentType: 'debit' },
    },
    {
      name: 'no paymentMethod at all falls back to the account default',
      tx: {},
      account: { kind: 'BANK', defaultPaymentType: 'debit' },
      expected: { paymentType: 'debit' },
    },
    {
      name: 'no paymentMethod and no account default falls back to debit',
      tx: {},
      account: { kind: 'BANK' },
      expected: { paymentType: 'debit' },
    },
  ];

  for (const { name, tx, account, expected } of cases) {
    assert.deepEqual(derivePaymentType(tx, account), expected, name);
  }
});

// --- step 8: deriveDirection, the direction cross-check -------------------

test('deriveDirection: tx.type is primary, amount sign is a cross-check', () => {
  const cases: Array<{
    name: string;
    tx: Parameters<typeof deriveDirection>[0];
    expectAnomaly: boolean;
    expectedDirection?: 'outflow' | 'inflow';
  }> = [
    { name: 'DEBIT + negative amount agree: outflow', tx: { type: 'DEBIT', amount: -42 }, expectAnomaly: false, expectedDirection: 'outflow' },
    { name: 'CREDIT + positive amount agree: inflow', tx: { type: 'CREDIT', amount: 42 }, expectAnomaly: false, expectedDirection: 'inflow' },
    { name: 'DEBIT + positive amount disagree: anomaly', tx: { type: 'DEBIT', amount: 42 }, expectAnomaly: true },
    { name: 'CREDIT + negative amount disagree: anomaly', tx: { type: 'CREDIT', amount: -42 }, expectAnomaly: true },
    { name: 'no tx.type: falls back to the sign alone (negative -> outflow)', tx: { type: undefined, amount: -1 }, expectAnomaly: false, expectedDirection: 'outflow' },
    { name: 'no tx.type: falls back to the sign alone (positive -> inflow)', tx: { type: undefined, amount: 1 }, expectAnomaly: false, expectedDirection: 'inflow' },
  ];

  for (const { name, tx, expectAnomaly, expectedDirection } of cases) {
    const result = deriveDirection(tx);
    if (expectAnomaly) {
      assert.equal(result.direction, undefined, name);
      assert.ok(result.anomalyReason, `${name}: expected an anomalyReason`);
    } else {
      assert.equal(result.direction, expectedDirection, name);
      assert.equal(result.anomalyReason, undefined, name);
    }
  }
});

// --- step 9: deriveInstallments, the plausibility guard --------------------

test('deriveInstallments: plausibility guard and the MAX_INSTALLMENTS bound', () => {
  const cases: Array<{
    name: string;
    fields: Parameters<typeof deriveInstallments>[0];
    expected: ReturnType<typeof deriveInstallments>;
  }> = [
    { name: 'missing current: undefined', fields: { installmentTotal: 6 }, expected: undefined },
    { name: 'missing total: undefined', fields: { installmentCurrent: 3 }, expected: undefined },
    { name: 'a plausible mid-series installment', fields: { installmentCurrent: 3, installmentTotal: 6 }, expected: { current: 3, total: 6 } },
    { name: 'total of 1 is not an installment plan', fields: { installmentCurrent: 1, installmentTotal: 1 }, expected: undefined },
    { name: 'current below 1 is implausible', fields: { installmentCurrent: 0, installmentTotal: 6 }, expected: undefined },
    { name: 'current above total is implausible', fields: { installmentCurrent: 7, installmentTotal: 6 }, expected: undefined },
    { name: 'total at the MAX_INSTALLMENTS bound is accepted', fields: { installmentCurrent: 1, installmentTotal: 72 }, expected: { current: 1, total: 72 } },
    { name: 'total over the MAX_INSTALLMENTS bound is rejected', fields: { installmentCurrent: 1, installmentTotal: 73 }, expected: undefined },
    { name: 'a wildly unbounded total is rejected, not just clamped', fields: { installmentCurrent: 1, installmentTotal: 999999 }, expected: undefined },
  ];

  for (const { name, fields, expected } of cases) {
    assert.deepEqual(deriveInstallments(fields), expected, name);
  }
});

// --- step 11: anchorPurchaseDate, the anchor-date back-off ----------------

test('anchorPurchaseDate: a mid-series row backs off to the purchase month', () => {
  const cases: Array<{
    name: string;
    row: { date: string };
    installments?: { current: number };
    expected: string;
  }> = [
    {
      name: 'no installments: the row date is already the purchase date',
      row: { date: '2026-06-04' },
      installments: undefined,
      expected: '2026-06-04',
    },
    {
      name: 'installment 1 of N: no back-off needed',
      row: { date: '2026-06-04' },
      installments: { current: 1 },
      expected: '2026-06-04',
    },
    {
      name: '3 of 6, posted in June, purchased in April',
      row: { date: '2026-06-04' },
      installments: { current: 3 },
      expected: '2026-04-04',
    },
    {
      name: 'boundary: a January posting backs into the previous December',
      row: { date: '2026-01-10' },
      installments: { current: 2 },
      expected: '2025-12-10',
    },
    {
      name: 'boundary: a day-31 posting backs off across a 3-month gap, spanning a shorter month',
      row: { date: '2026-05-31' },
      // Backing off 3 months from May 31 lands on Feb (28 days in 2026), so the
      // reconstruction clamps to the last valid day of that month rather than
      // overflowing into March.
      installments: { current: 4 },
      expected: '2026-02-28',
    },
    {
      name: 'boundary: a day-31 posting backing off one month clamps to April 30',
      row: { date: '2026-05-31' },
      installments: { current: 2 },
      expected: '2026-04-30',
    },
  ];

  for (const { name, row, installments, expected } of cases) {
    assert.equal(anchorPurchaseDate(row, installments), expected, name);
  }
});

// --- step 10: shouldIgnore, the double-counting guard ----------------------

const baseTx = {
  id: 'tx-1',
  accountId: 'acc-1',
  date: '2026-06-01',
  description: 'COMPRA QUALQUER',
  amount: -50,
};

test('shouldIgnore: credit-inflow — an inflow on a CREDIT account is never income', () => {
  const outcome = shouldIgnore(
    baseTx,
    { kind: 'CREDIT' },
    'inflow',
    { linkedAccountIds: new Set() }
  );
  assert.equal(outcome.ignored, true);
  assert.equal(outcome.ruleId, 'credit-inflow');
});

test('shouldIgnore: credit-inflow does not fire on a CREDIT outflow (an ordinary purchase)', () => {
  const outcome = shouldIgnore(
    baseTx,
    { kind: 'CREDIT' },
    'outflow',
    { linkedAccountIds: new Set() }
  );
  assert.equal(outcome.ignored, false);
});

test('shouldIgnore: card-bill-payment — an outflow on a BANK account paying a card bill', () => {
  const descriptions = ['PAGAMENTO FATURA CARTAO', 'PAGTO CARTAO VISA', 'PAGAMENTO DE CARTAO', 'PAGAMENTO CARTAO XPTO'];
  for (const description of descriptions) {
    const outcome = shouldIgnore(
      { ...baseTx, description },
      { kind: 'BANK' },
      'outflow',
      { linkedAccountIds: new Set() }
    );
    assert.equal(outcome.ignored, true, description);
    assert.equal(outcome.ruleId, 'card-bill-payment', description);
  }
});

test('shouldIgnore: card-bill-payment does not fire on an ordinary BANK outflow', () => {
  const outcome = shouldIgnore(
    { ...baseTx, description: 'SUPERMERCADO BOM PRECO' },
    { kind: 'BANK' },
    'outflow',
    { linkedAccountIds: new Set() }
  );
  assert.equal(outcome.ignored, false);
});

test('shouldIgnore: card-bill-payment does not fire on an inflow (only checks outflows)', () => {
  const outcome = shouldIgnore(
    { ...baseTx, description: 'PAGAMENTO FATURA CARTAO' },
    { kind: 'BANK' },
    'inflow',
    { linkedAccountIds: new Set() }
  );
  assert.equal(outcome.ignored, false);
});

test('shouldIgnore: own-transfer — only the counterparty side is checked, never the holder\'s own side', () => {
  const cases: Array<{
    name: string;
    ownDocuments?: string;
    tx: Parameters<typeof shouldIgnore>[0];
    direction: Parameters<typeof shouldIgnore>[2];
    linkedAccountIds: Set<string>;
    expectedIgnored: boolean;
  }> = [
    {
      name: 'outflow whose counterparty (receiver) document is in PLUGGY_OWN_DOCUMENTS: ignored',
      ownDocuments: '11122233344,55566677788',
      tx: { ...baseTx, paymentData: { receiver: { documentNumber: '11122233344' } } },
      direction: 'outflow',
      linkedAccountIds: new Set(),
      expectedIgnored: true,
    },
    {
      name: 'inflow whose counterparty (payer) document is in PLUGGY_OWN_DOCUMENTS: ignored',
      ownDocuments: '11122233344,55566677788',
      tx: { ...baseTx, paymentData: { payer: { documentNumber: '11122233344' } } },
      direction: 'inflow',
      linkedAccountIds: new Set(),
      expectedIgnored: true,
    },
    {
      name: 'salary shape: inflow whose RECEIVER (the holder) is in PLUGGY_OWN_DOCUMENTS but whose payer is not — must NOT be ignored',
      ownDocuments: '99988877766',
      tx: { ...baseTx, paymentData: { receiver: { documentNumber: '99988877766' }, payer: { documentNumber: '00000000000' } } },
      direction: 'inflow',
      linkedAccountIds: new Set(),
      expectedIgnored: false,
    },
    {
      name: 'ordinary purchase shape: outflow whose PAYER (the holder) is in PLUGGY_OWN_DOCUMENTS but whose receiver is not — must NOT be ignored',
      ownDocuments: '11122233344',
      tx: { ...baseTx, paymentData: { payer: { documentNumber: '11122233344' }, receiver: { documentNumber: '00000000000' } } },
      direction: 'outflow',
      linkedAccountIds: new Set(),
      expectedIgnored: false,
    },
    {
      name: 'outflow whose counterparty (receiver) accountId is another linked PluggyAccount: ignored',
      tx: { ...baseTx, paymentData: { receiver: { accountId: 'acc-2' } } },
      direction: 'outflow',
      linkedAccountIds: new Set(['acc-1', 'acc-2']),
      expectedIgnored: true,
    },
    {
      name: 'inflow whose counterparty (payer) accountId is another linked PluggyAccount: ignored',
      tx: { ...baseTx, paymentData: { payer: { accountId: 'acc-2' } } },
      direction: 'inflow',
      linkedAccountIds: new Set(['acc-1', 'acc-2']),
      expectedIgnored: true,
    },
    {
      name: 'salary shape via accountId: inflow whose RECEIVER (the holder) accountId is linked but whose payer is not — must NOT be ignored',
      tx: { ...baseTx, paymentData: { receiver: { accountId: 'acc-1' }, payer: { accountId: 'someone-elses-account' } } },
      direction: 'inflow',
      linkedAccountIds: new Set(['acc-1']),
      expectedIgnored: false,
    },
    {
      name: 'does not fire on an unrelated counterparty',
      tx: { ...baseTx, paymentData: { receiver: { accountId: 'someone-elses-account', documentNumber: '00000000000' } } },
      direction: 'outflow',
      linkedAccountIds: new Set(['acc-1']),
      expectedIgnored: false,
    },
  ];

  for (const { name, ownDocuments, tx, direction, linkedAccountIds, expectedIgnored } of cases) {
    const previous = process.env.PLUGGY_OWN_DOCUMENTS;
    if (ownDocuments === undefined) delete process.env.PLUGGY_OWN_DOCUMENTS;
    else process.env.PLUGGY_OWN_DOCUMENTS = ownDocuments;
    try {
      const outcome = shouldIgnore(tx, { kind: 'BANK' }, direction, { linkedAccountIds });
      assert.equal(outcome.ignored, expectedIgnored, name);
      if (expectedIgnored) assert.equal(outcome.ruleId, 'own-transfer', name);
    } finally {
      if (previous === undefined) delete process.env.PLUGGY_OWN_DOCUMENTS;
      else process.env.PLUGGY_OWN_DOCUMENTS = previous;
    }
  }
});

test('shouldIgnore: an ordinary pending row matches no ignore rule', () => {
  const outcome = shouldIgnore(
    baseTx,
    { kind: 'BANK' },
    'outflow',
    { linkedAccountIds: new Set(['acc-1']) }
  );
  assert.equal(outcome.ignored, false);
  assert.equal(outcome.ruleId, undefined);
});

test('PLUGGY_IGNORE_RULES: every rule carries a stable id and a human reason for statusReason', () => {
  for (const rule of PLUGGY_IGNORE_RULES) {
    assert.ok(rule.id.length > 0);
    assert.ok(rule.reason.length > 0);
  }
});
