import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkHardRequirements, linkLast, parseCriteria, parseListingCheck } from '../src/nurture.ts';
test('criteria from notes: keeps sane values only', () => {
  const c = parseCriteria({ areas: ['Rancho Cucamonga', 'Corona', 'Chino', '', 42], budgetMin: 500000, budgetMax: 600000, bedsMin: 4 });
  assert.deepEqual(c, { areas: ['Rancho Cucamonga', 'Corona', 'Chino'], budgetMin: 500000, budgetMax: 600000, bedsMin: 4 });
  assert.deepEqual(parseCriteria({ budgetMax: 600, bedsMin: 40 }), {});
  assert.deepEqual(parseCriteria(null), {});
});

test('must-haves from notes: numbers, single story, features', () => {
  const c = parseCriteria({ areas: ['Fontana', 'Riverside', 'Rialto'], lotMinSqft: 21780, singleStory: true, noHoa: true, garageMin: 3, mustHave: ['pool', 'RV parking'], niceToHave: ['two story'], sqftMin: 10 });
  assert.deepEqual(c, { areas: ['Fontana', 'Riverside', 'Rialto'], lotMinSqft: 21780, singleStory: true, noHoa: true, garageMin: 3, mustHave: ['pool', 'RV parking'], niceToHave: ['two story'] });
});

test('hard requirements: unknown counts as a fail', () => {
  const d = { hoaFee: 0, garage: 2, yearBuilt: 1990, lotSqft: 5000 };
  assert.equal(checkHardRequirements({ noHoa: true }, d), null);
  assert.equal(checkHardRequirements({ noHoa: true }, { ...d, hoaFee: null }), 'HOA unknown');
  assert.equal(checkHardRequirements({ garageMin: 3 }, d), 'garage under 3');
  assert.equal(checkHardRequirements({ lotMinSqft: 21780 }, d), 'lot too small');
  assert.equal(checkHardRequirements({ yearBuiltMin: 2015 }, d), 'built before 2015');
});

test('listing check keeps only real quotes and real yeses', () => {
  const text = 'Beautifully updated 3-bedroom POOL home with a main-floor bedroom and private yard.';
  const r = parseListingCheck({ has: { pool: true, ADU: false }, quotes: ['main-floor bedroom', 'huge private lot with views'] }, ['pool', 'ADU'], text);
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, ['ADU']);
  assert.deepEqual(r.facts, ['main-floor bedroom']);
  assert.equal(parseListingCheck({ has: { pool: true } }, ['pool'], text).ok, true);
});

test('link goes last, on its own line, after the question', () => {
  assert.equal(
    linkLast("Hi Ann, it's Jeffry. 5531 Corte Fiesta: 2 bd/2 ba for $394,500. https://x.com/listing-detail/1/5531 Want to see it this weekend?"),
    "Hi Ann, it's Jeffry. 5531 Corte Fiesta: 2 bd/2 ba for $394,500. Want to see it this weekend?\n\nhttps://x.com/listing-detail/1/5531",
  );
  assert.equal(linkLast('No link here.'), 'No link here.');
});
