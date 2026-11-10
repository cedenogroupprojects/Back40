import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCriteria } from '../src/nurture.ts';
test('criteria from notes: keeps sane values only', () => {
  const c = parseCriteria({ areas: ['Rancho Cucamonga', 'Corona', 'Chino', '', 42], budgetMin: 500000, budgetMax: 600000, bedsMin: 4 });
  assert.deepEqual(c, { areas: ['Rancho Cucamonga', 'Corona', 'Chino'], budgetMin: 500000, budgetMax: 600000, bedsMin: 4 });
  assert.deepEqual(parseCriteria({ budgetMax: 600, bedsMin: 40 }), {});
  assert.deepEqual(parseCriteria(null), {});
});
