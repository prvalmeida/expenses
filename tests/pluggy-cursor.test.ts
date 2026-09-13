import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAfterCursor } from '../lib/pluggy/client';

// GET /v2/transactions replaced the retired page-based /transactions (which
// now answers 410). Its contract: `next` is a full query string when another
// page exists and null on the last page, and a follow-up request must carry
// only the URL-DECODED `after` value — re-sending the whole `next` string as
// the cursor is a 400. These cases pin that parsing, since the sync loop's
// termination depends on it.

test('parseAfterCursor: extracts the decoded after value from a next query string', () => {
  const next = '?accountId=c35f9b12-a261-4fa7-97ee-7e9c72254d8c&after=MjAyNi0wOS0wOQ%3D%3D';
  assert.equal(parseAfterCursor(next), 'MjAyNi0wOS0wOQ==');
});

test('parseAfterCursor: URL-decodes reserved characters in the cursor', () => {
  // A cursor carrying +, / and = survives round-tripping only if it is read
  // through URLSearchParams rather than sliced out of the string by hand.
  const raw = 'a+b/c==';
  const next = `?accountId=acc-1&after=${encodeURIComponent(raw)}`;
  assert.equal(parseAfterCursor(next), raw);
});

test('parseAfterCursor: tolerates a next without the leading question mark', () => {
  assert.equal(parseAfterCursor('accountId=acc-1&after=cursor-2'), 'cursor-2');
});

test('parseAfterCursor: null/undefined/empty next means no further page', () => {
  assert.equal(parseAfterCursor(null), undefined);
  assert.equal(parseAfterCursor(undefined), undefined);
  assert.equal(parseAfterCursor(''), undefined);
});

test('parseAfterCursor: a next carrying no after ends the loop instead of repeating page 1', () => {
  // Treating an unparseable cursor as "no more pages" is what stops the sync
  // from refetching the first page forever against Pluggy's rate limits.
  assert.equal(parseAfterCursor('?accountId=acc-1'), undefined);
  assert.equal(parseAfterCursor('?accountId=acc-1&after='), undefined);
});

// --- the sync loop's use of the cursor ------------------------------------
// syncAccount itself needs Mongoose, so the loop shape is asserted here
// against the same helper it uses, with a stubbed pager.

async function drain(
  pages: Array<{ results: { id: string }[]; next: string | null }>,
  maxPages: number
): Promise<{ ids: string[]; calls: (string | undefined)[] }> {
  const ids: string[] = [];
  const calls: (string | undefined)[] = [];
  let after: string | undefined;

  for (let page = 1; page <= maxPages; page++) {
    calls.push(after);
    const current = pages.shift();
    if (!current) break;
    ids.push(...current.results.map(r => r.id));
    after = parseAfterCursor(current.next);
    if (!after) break;
  }

  return { ids, calls };
}

test('sync loop: follows next across pages and stops on null', async () => {
  const { ids, calls } = await drain(
    [
      { results: [{ id: 'a' }, { id: 'b' }], next: '?accountId=acc-1&after=cur-1' },
      { results: [{ id: 'c' }], next: '?accountId=acc-1&after=cur-2' },
      { results: [{ id: 'd' }], next: null },
    ],
    50
  );

  assert.deepEqual(ids, ['a', 'b', 'c', 'd']);
  // First request carries no cursor; each later one carries the previous
  // page's decoded `after`.
  assert.deepEqual(calls, [undefined, 'cur-1', 'cur-2']);
});

test('sync loop: a short page with a cursor is NOT the end of the list', async () => {
  // The old page-based loop broke on `rows.length < PAGE_SIZE`. Under v2 a
  // short page may still have a successor, and stopping there would silently
  // drop every transaction after it.
  const { ids } = await drain(
    [
      { results: [{ id: 'a' }], next: '?accountId=acc-1&after=cur-1' },
      { results: [{ id: 'b' }, { id: 'c' }], next: null },
    ],
    50
  );

  assert.deepEqual(ids, ['a', 'b', 'c']);
});

test('sync loop: an empty page with no cursor terminates cleanly', async () => {
  const { ids } = await drain([{ results: [], next: null }], 50);
  assert.deepEqual(ids, []);
});

test('sync loop: MAX_SYNC_PAGES caps a cursor that never terminates', async () => {
  const endless = Array.from({ length: 10 }, (_, i) => ({
    results: [{ id: `row-${i}` }],
    next: `?accountId=acc-1&after=cur-${i}`,
  }));

  const { ids } = await drain(endless, 3);
  assert.deepEqual(ids, ['row-0', 'row-1', 'row-2']);
});
