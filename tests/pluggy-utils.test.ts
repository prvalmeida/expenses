import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mapPluggyTransaction,
  derivePaymentType,
  deriveDirection,
  deriveInstallments,
  anchorPurchaseDate,
  shouldIgnore,
  PLUGGY_IGNORE_RULES,
} from '../lib/utils/pluggyUtils';

// --- mapPluggyTransaction: the raw-field reads ---------------------------

test('mapPluggyTransaction: narrows the timestamp and drops empty merchant names', () => {
  const base = {
    id: 'tx-1',
    accountId: 'acc-1',
    description: '  PANVEL   MATRIZ ',
    amount: 34.52,
  };

  // Pluggy sends a full ISO timestamp; everything downstream compares
  // PluggyTransaction.date as a YYYY-MM-DD string.
  const narrowed = mapPluggyTransaction({ ...base, date: '2026-08-14T03:00:00.000Z' });
  assert.equal(narrowed.date, '2026-08-14');
  assert.equal(narrowed.description, 'PANVEL MATRIZ');
  assert.equal(narrowed.descriptionRaw, '  PANVEL   MATRIZ ');

  // A bare date passes through untouched.
  assert.equal(mapPluggyTransaction({ ...base, date: '2026-08-14' }).date, '2026-08-14');

  // Both merchant name fields come back empty on some live rows.
  const withName = mapPluggyTransaction({
    ...base,
    date: '2026-08-14T03:00:00.000Z',
    merchant: { cnpj: '', name: 'panvel', businessName: '' },
  });
  assert.equal(withName.merchantName, 'panvel');

  const businessOnly = mapPluggyTransaction({
    ...base,
    date: '2026-08-14T03:00:00.000Z',
    merchant: { name: '', businessName: 'PAYPAL DO BRASIL' },
  });
  assert.equal(businessOnly.merchantName, 'PAYPAL DO BRASIL');

  const noMerchant = mapPluggyTransaction({ ...base, date: '2026-08-14T03:00:00.000Z', merchant: null });
  assert.equal(noMerchant.merchantName, undefined);
});

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
  const bank = { kind: 'BANK' };
  const card = { kind: 'CREDIT' };
  const cases: Array<{
    name: string;
    tx: Parameters<typeof deriveDirection>[0];
    account: Parameters<typeof deriveDirection>[1];
    expectAnomaly: boolean;
    expectedDirection?: 'outflow' | 'inflow';
  }> = [
    // BANK: an outflow is negative.
    { name: 'BANK DEBIT + negative amount agree: outflow', tx: { type: 'DEBIT', amount: -42 }, account: bank, expectAnomaly: false, expectedDirection: 'outflow' },
    { name: 'BANK CREDIT + positive amount agree: inflow', tx: { type: 'CREDIT', amount: 42 }, account: bank, expectAnomaly: false, expectedDirection: 'inflow' },
    { name: 'BANK DEBIT + positive amount disagree: anomaly', tx: { type: 'DEBIT', amount: 42 }, account: bank, expectAnomaly: true },
    { name: 'BANK CREDIT + negative amount disagree: anomaly', tx: { type: 'CREDIT', amount: -42 }, account: bank, expectAnomaly: true },
    { name: 'BANK, no tx.type: falls back to the sign alone (negative -> outflow)', tx: { type: undefined, amount: -1 }, account: bank, expectAnomaly: false, expectedDirection: 'outflow' },
    { name: 'BANK, no tx.type: falls back to the sign alone (positive -> inflow)', tx: { type: undefined, amount: 1 }, account: bank, expectAnomaly: false, expectedDirection: 'inflow' },
    // CREDIT: the convention is inverted — a purchase is a positive DEBIT.
    { name: 'CREDIT card DEBIT + positive amount agree: outflow (a purchase)', tx: { type: 'DEBIT', amount: 34.52 }, account: card, expectAnomaly: false, expectedDirection: 'outflow' },
    { name: 'CREDIT card CREDIT + negative amount agree: inflow (a refund)', tx: { type: 'CREDIT', amount: -0.08 }, account: card, expectAnomaly: false, expectedDirection: 'inflow' },
    { name: 'CREDIT card DEBIT + negative amount disagree: anomaly', tx: { type: 'DEBIT', amount: -42 }, account: card, expectAnomaly: true },
    { name: 'CREDIT card CREDIT + positive amount disagree: anomaly', tx: { type: 'CREDIT', amount: 42 }, account: card, expectAnomaly: true },
    { name: 'CREDIT card, no tx.type: positive is an outflow', tx: { type: undefined, amount: 1 }, account: card, expectAnomaly: false, expectedDirection: 'outflow' },
    { name: 'CREDIT card, no tx.type: negative is an inflow', tx: { type: undefined, amount: -1 }, account: card, expectAnomaly: false, expectedDirection: 'inflow' },
  ];

  for (const { name, tx, account, expectAnomaly, expectedDirection } of cases) {
    const result = deriveDirection(tx, account);
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
    row: { date: string; purchaseDate?: string | null };
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
    // Pluggy's own purchaseDate wins over the month arithmetic whenever it is
    // present — the live 4/4 row the fallback would have put three weeks and a
    // month late.
    {
      name: 'reported purchaseDate wins over the back-off',
      row: { date: '2026-08-14', purchaseDate: '2026-04-23' },
      installments: { current: 4 },
      expected: '2026-04-23',
    },
    {
      name: 'reported purchaseDate is used on a single-charge row too',
      row: { date: '2026-08-14', purchaseDate: '2026-08-12' },
      installments: undefined,
      expected: '2026-08-12',
    },
    {
      name: 'a purchaseDate equal to the posting date is fine',
      row: { date: '2026-08-14', purchaseDate: '2026-08-14' },
      installments: undefined,
      expected: '2026-08-14',
    },
    // A charge cannot post before it happens, so a later value is bad upstream
    // data: fall back rather than file the expense in a future month.
    {
      name: 'a purchaseDate after the posting date is rejected, back-off applies',
      row: { date: '2026-06-04', purchaseDate: '2026-09-01' },
      installments: { current: 3 },
      expected: '2026-04-04',
    },
    {
      name: 'a purchaseDate after the posting date on a single charge falls back to the row date',
      row: { date: '2026-06-04', purchaseDate: '2026-09-01' },
      installments: undefined,
      expected: '2026-06-04',
    },
    {
      name: 'null/blank purchaseDate is ignored',
      row: { date: '2026-06-04', purchaseDate: null },
      installments: { current: 3 },
      expected: '2026-04-04',
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
