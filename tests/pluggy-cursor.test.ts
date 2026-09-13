import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAfterCursor, drainCursor, CursorPage } from '../lib/pluggy/client';

// GET /v2/transactions replaced the retired page-based /transactions (which
// now answers 410). Its contract: `next` is a full query string when another
// page exists and null on the last page, and a follow-up request must carry
// only the URL-DECODED `after` value — re-sending the whole `next` string is
// a 400. These cases pin that parsing and the drain loop that depends on it.

test('parseAfterCursor: extracts the decoded after value from a next query string', () => {
  const next = '?accountId=c35f9b12-a261-4fa7-97ee-7e9c72254d8c&after=MjAyNi0wOS0wOQ%3D%3D';
  assert.equal(parseAfterCursor(next), 'MjAyNi0wOS0wOQ==');
});

test('parseAfterCursor: URL-decodes reserved characters in the cursor', () => {
  // A base64 cursor carrying +, / and = only survives if it is read through
  // URLSearchParams rather than sliced out of the string by hand.
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

// --- drainCursor: the loop syncAccount actually runs ----------------------

function pager(pages: CursorPage<{ id: string }>[]) {
  const cursorsSeen: (string | undefined)[] = [];
  let i = 0;
  return {
    cursorsSeen,
    fetchPage: async (after: string | undefined) => {
      cursorsSeen.push(after);
      return pages[Math.min(i++, pages.length - 1)];
    },
  };
}

async function collect(pages: CursorPage<{ id: string }>[], maxPages = 50) {
  const ids: string[] = [];
  const p = pager(pages);
  const result = await drainCursor(p.fetchPage, rows => { ids.push(...rows.map(r => r.id)); }, maxPages);
  return { ids, result, cursorsSeen: p.cursorsSeen };
}

test('drainCursor: follows next across pages and stops on null', async () => {
  const { ids, result, cursorsSeen } = await collect([
    { results: [{ id: 'a' }, { id: 'b' }], next: '?accountId=acc-1&after=cur-1' },
    { results: [{ id: 'c' }], next: '?accountId=acc-1&after=cur-2' },
    { results: [{ id: 'd' }], next: null },
  ]);

  assert.deepEqual(ids, ['a', 'b', 'c', 'd']);
  // First request carries no cursor; each later one carries the previous
  // page's decoded `after`.
  assert.deepEqual(cursorsSeen, [undefined, 'cur-1', 'cur-2']);
  assert.equal(result.pages, 3);
  assert.equal(result.truncated, false);
});

test('drainCursor: a short page with a cursor is NOT the end of the list', async () => {
  // The old page-based loop broke on `rows.length < PAGE_SIZE`. Under v2 a
  // short page may still have a successor, and stopping there would silently
  // drop every transaction after it.
  const { ids, result } = await collect([
    { results: [{ id: 'a' }], next: '?accountId=acc-1&after=cur-1' },
    { results: [{ id: 'b' }, { id: 'c' }], next: null },
  ]);

  assert.deepEqual(ids, ['a', 'b', 'c']);
  assert.equal(result.truncated, false);
});

test('drainCursor: an empty page with no cursor terminates cleanly', async () => {
  const { ids, result } = await collect([{ results: [], next: null }]);
  assert.deepEqual(ids, []);
  assert.equal(result.pages, 1);
  assert.equal(result.truncated, false);
});

test('drainCursor: reports truncated when the cap is hit with a cursor still open', async () => {
  // This is the case syncAccount must treat as a failed read: the account was
  // not fully fetched, so advancing lastSyncedAt would put the un-read rows
  // permanently outside every future window.
  const { ids, result } = await collect(
    [{ results: [{ id: 'row' }], next: '?accountId=acc-1&after=stuck' }],
    3
  );

  assert.equal(result.pages, 3);
  assert.equal(result.truncated, true);
  assert.deepEqual(ids, ['row', 'row', 'row']);
});

test('drainCursor: a cursor that never advances is capped rather than looping forever', async () => {
  const { result, cursorsSeen } = await collect(
    [{ results: [{ id: 'x' }], next: '?accountId=acc-1&after=same' }],
    4
  );

  assert.equal(result.truncated, true);
  assert.deepEqual(cursorsSeen, [undefined, 'same', 'same', 'same']);
});

test('drainCursor: exhausting the list exactly at the cap is NOT truncated', async () => {
  // Off-by-one guard: a run that ends on its last allowed page has read
  // everything, and must not be reported as a failed read.
  const { result } = await collect(
    [
      { results: [{ id: 'a' }], next: '?accountId=acc-1&after=cur-1' },
      { results: [{ id: 'b' }], next: null },
    ],
    2
  );

  assert.equal(result.pages, 2);
  assert.equal(result.truncated, false);
});

test('drainCursor: awaits an async onPage before fetching the next page', async () => {
  // syncAccount does a sequential DB write per row inside onPage; if the loop
  // did not await it, pages would interleave with the upserts.
  const order: string[] = [];
  let i = 0;
  const pages: CursorPage<{ id: string }>[] = [
    { results: [{ id: 'a' }], next: '?after=cur-1' },
    { results: [{ id: 'b' }], next: null },
  ];

  await drainCursor(
    async () => { order.push(`fetch-${i}`); return pages[i++]; },
    async rows => {
      await new Promise(resolve => setTimeout(resolve, 5));
      order.push(`processed-${rows[0].id}`);
    },
    50
  );

  assert.deepEqual(order, ['fetch-0', 'processed-a', 'fetch-1', 'processed-b']);
});
