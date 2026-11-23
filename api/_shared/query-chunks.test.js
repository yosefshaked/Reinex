/* eslint-env node */
import test from 'node:test';
import assert from 'node:assert/strict';
import { chunkArray, selectInChunks } from './query-chunks.js';

/** A query builder stand-in that records every `.in()` and `.range()` and answers from `respond`. */
function fakeBuilder(calls, respond) {
  const state = { filters: [], range: null };
  const builder = {
    in(column, values) {
      state.filters.push({ column, values });
      return builder;
    },
    range(from, to) {
      state.range = [from, to];
      return builder;
    },
    then(resolve, reject) {
      calls.push(state);
      return Promise.resolve(respond(state, calls.length)).then(resolve, reject);
    },
  };
  return builder;
}

const idsOf = (count) => Array.from({ length: count }, (_, index) => `id-${index}`);

test('chunkArray splits a list into pieces of at most the size, in order', () => {
  assert.deepEqual(chunkArray([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunkArray([], 2), []);
  assert.deepEqual(chunkArray(null, 2), []);
  assert.equal(chunkArray(idsOf(250)).length, 3);
});

test('selectInChunks sends one request per chunk and joins the rows in chunk order', async () => {
  const calls = [];
  const ids = idsOf(250);
  const { data, error } = await selectInChunks(
    () => fakeBuilder(calls, (state) => ({ data: state.filters[0].values.map((id) => ({ id })), error: null })),
    'employee_id',
    ids,
  );
  assert.equal(error, null);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls.map((call) => call.filters[0].values.length), [100, 100, 50]);
  assert.ok(calls.every((call) => call.filters[0].column === 'employee_id'));
  assert.deepEqual(data.map((row) => row.id), ids);
});

test('selectInChunks makes no request for no ids', async () => {
  let built = 0;
  const result = await selectInChunks(() => { built += 1; return fakeBuilder([], () => ({ data: [], error: null })); }, 'employee_id', []);
  assert.deepEqual(result, { data: [], error: null });
  assert.equal((await selectInChunks(() => { built += 1; }, 'employee_id', undefined)).data.length, 0);
  assert.equal(built, 0);
});

test('selectInChunks returns the first error and stops asking', async () => {
  const calls = [];
  const failure = { code: 'XX000', message: 'boom' };
  const result = await selectInChunks(
    () => fakeBuilder(calls, (_state, number) => (number === 2 ? { data: null, error: failure } : { data: [{ id: number }], error: null })),
    'employee_id',
    idsOf(450),
    { size: 100 },
  );
  assert.equal(result.data, null);
  assert.equal(result.error, failure);
  assert.equal(calls.length, 2);
});

test('selectInChunks treats a missing data array as no rows', async () => {
  const { data, error } = await selectInChunks(() => fakeBuilder([], () => ({ data: null, error: null })), 'employee_id', ['a']);
  assert.equal(error, null);
  assert.deepEqual(data, []);
});

test('selectInChunks pages a chunk until a short page and keeps every row', async () => {
  const calls = [];
  const { data, error } = await selectInChunks(
    () => fakeBuilder(calls, (state) => {
      const [from, to] = state.range;
      const total = 5;
      const rows = [];
      for (let index = from; index <= Math.min(to, total - 1); index += 1) rows.push({ n: index });
      return { data: rows, error: null };
    }),
    'lesson_instance_id',
    idsOf(3),
    { size: 2, pageSize: 2 },
  );
  assert.equal(error, null);
  // chunk 1 (2 ids): pages 0-1, 2-3, 4-5; chunk 2 (1 id): same
  assert.equal(calls.length, 6);
  assert.equal(data.length, 10);
});

test('selectInChunks keeps the filters the caller put on the query', async () => {
  const calls = [];
  const { error } = await selectInChunks(
    () => fakeBuilder(calls, () => ({ data: [], error: null })).in('pay_basis', ['hourly']),
    'employee_id',
    idsOf(3),
  );
  assert.equal(error, null);
  assert.deepEqual(calls[0].filters.map((filter) => filter.column), ['pay_basis', 'employee_id']);
});
