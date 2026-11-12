import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RULES, rankToday, heatScore, labelFor, staleHotLeads } from '../src/ranking.ts';
import { dailyScore, streak } from '../src/score.ts';
import { lofty, mapLoftyLead } from '../src/crm/lofty.ts';
import { followUpBoss } from '../src/crm/followupboss.ts';
import type { Lead } from '../src/types.ts';

const NOW = Date.parse('2026-11-08T16:00:00Z');
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

function lead(p: Partial<Lead> & { id: string }): Lead {
  return {
    orgId: 'org1', crm: 'lofty', crmLeadId: p.id, assignedUserId: 'u1', firstName: p.id, lastName: 'X',
    stage: 'Nurture', tags: [], createdAt: hoursAgo(24 * 30), lastContactAt: hoursAgo(24), nextFollowUpAt: null,
    signals: [], fields: {}, pinned: false, touches: 1, timeline: [], ...p,
  };
}

test('brand-new uncontacted leads always lead the list, newest first', () => {
  const list = rankToday(
    [
      lead({ id: 'hot', stage: 'Actively Looking', signals: [{ kind: 'listing_view', at: hoursAgo(2) }], fields: { preApproved: true } }),
      lead({ id: 'newOld', createdAt: hoursAgo(5), lastContactAt: null }),
      lead({ id: 'newFresh', createdAt: hoursAgo(0.2), lastContactAt: null }),
    ],
    DEFAULT_RULES,
    NOW,
  );
  assert.deepEqual(list.map((r) => r.lead.id), ['newFresh', 'newOld', 'hot']);
  assert.equal(list[0]!.label, 'brand_new');
});

test('list is capped at 10, but pins always make it', () => {
  const many = Array.from({ length: 14 }, (_, i) => lead({ id: `h${i}`, stage: 'Actively Looking', signals: [{ kind: 'site_visit', at: hoursAgo(25 + i) }] }));
  const pinned = lead({ id: 'pin', pinned: true });
  const list = rankToday([...many, pinned], DEFAULT_RULES, NOW);
  assert.ok(list.some((r) => r.lead.id === 'pin'));
  assert.ok(list.length <= 11);
});

test('add, never take: anyone who engaged today gets a card past the cap', () => {
  const busy = Array.from({ length: 12 }, (_, i) => lead({ id: `e${i}`, stage: 'Actively Looking', signals: [{ kind: 'site_visit', at: hoursAgo(i + 1) }] }));
  assert.equal(rankToday(busy, DEFAULT_RULES, NOW).length, 12);
});

test('hot lead untouched 2+ days is "slipping"; same rule for everyone', () => {
  const l = lead({ id: 'cold', stage: 'Actively Looking', lastContactAt: hoursAgo(24 * 3) });
  assert.equal(labelFor(l, DEFAULT_RULES, NOW), 'slipping');
  assert.equal(staleHotLeads([l], DEFAULT_RULES, NOW).length, 1);
  const fresh = lead({ id: 'warm', stage: 'Actively Looking', lastContactAt: hoursAgo(20) });
  assert.equal(staleHotLeads([fresh], DEFAULT_RULES, NOW).length, 0);
});

test('nurture lead with new activity comes back (Back 40 sweep)', () => {
  const l = lead({ id: 'mike', stage: 'Nurture', lastContactAt: hoursAgo(24 * 40), signals: [{ kind: 'listing_view', at: hoursAgo(3) }] });
  const list = rankToday([l], DEFAULT_RULES, NOW);
  assert.equal(list[0]?.label, 'back_again');
});

test('quiet leads only fill Today after every hot one, and closed ones never do', () => {
  const hot = lead({ id: 'hot', createdAt: hoursAgo(1), lastContactAt: null });
  const quiet = lead({ id: 'quiet' });
  const closed = lead({ id: 'closed', stage: 'Closed' });
  const today = rankToday([quiet, closed, hot], DEFAULT_RULES, NOW);
  assert.deepEqual(today.map((r) => r.lead.id), ['hot', 'quiet']);
  // "Give me 5 more" raises the cap.
  assert.equal(rankToday([quiet, hot], { ...DEFAULT_RULES, cap: 1 }, NOW).length, 1);
  assert.equal(rankToday([quiet, hot], { ...DEFAULT_RULES, cap: 1 }, NOW, 5).length, 2);
});

test('heat is bounded 0-100', () => {
  const l = lead({ id: 'max', createdAt: hoursAgo(0.1), lastContactAt: null, stage: 'Actively Looking', pinned: true, fields: { preApproved: true }, signals: Array(10).fill({ kind: 'site_visit', at: hoursAgo(1) }) });
  const h = heatScore(l, DEFAULT_RULES, NOW);
  assert.ok(h <= 100 && h >= 0);
});

test('score: every attempt earns points, a conversation more', () => {
  const s1 = dailyScore({ date: '2026-11-08', calls: [{ outcome: 'no_answer' }], staleHotLeads: 0 }, 6);
  const s2 = dailyScore({ date: '2026-11-08', calls: [{ outcome: 'talked' }], staleHotLeads: 0 }, 6);
  assert.ok(s1 > 0 && s2 > s1);
  const full = dailyScore({ date: '2026-11-08', calls: Array(6).fill({ outcome: 'talked' }), staleHotLeads: 0 }, 6);
  assert.equal(full, 100);
});

test('streak counts consecutive goal days and forgives an unfinished today', () => {
  const days = ['2026-11-05', '2026-11-06', '2026-11-07'].map((date) => ({ date, calls: Array(6).fill({ outcome: 'talked' as const }), staleHotLeads: 0 }));
  assert.equal(streak(days, 6, '2026-11-08'), 3);
});

test('Lofty lead maps into the standard lead card', () => {
  const m = mapLoftyLead({ leadId: 651095960136641, firstName: 'Marisol', lastName: 'Vega', phones: ['9095550142'], stage: 'Active Buyer', tags: [{ tagName: 'Zillow' }], lastVisit: '2026-11-07T20:00:00Z' });
  assert.equal(m.crmLeadId, '651095960136641');
  assert.deepEqual(m.tags, ['Zillow']);
  assert.equal(m.signals[0]?.kind, 'site_visit');
});

test('webhooks normalize to lead ids', () => {
  const ev = lofty.parseWebhook({ listId: 9, createdNote: [{ noteId: 1, leadId: 42 }] });
  assert.equal(ev[0]?.kind, 'note');
  assert.deepEqual(ev[0]?.crmLeadIds, ['42']);
  const fub = followUpBoss.parseWebhook({ event: 'peopleCreated', resourceIds: [7] });
  assert.equal(fub[0]?.kind, 'lead_created');
});

test('Leads tab holds only hot and warm leads — nurture and past clients stay in the CRM', async () => {
  const { hotAndWarm } = await import('../src/ranking.ts');
  const now = Date.parse('2026-11-08T15:00:00Z');
  const base = { orgId: 'o', crm: 'lofty' as const, crmLeadId: 'x', assignedUserId: 'u', tags: [], signals: [], fields: {}, pinned: false, touches: 0, timeline: [], createdAt: '2026-01-01T00:00:00Z' };
  const leads = [
    { ...base, id: 'new', firstName: 'N', lastName: 'L', stage: 'New Lead', createdAt: '2026-11-08T14:50:00Z' },
    { ...base, id: 'past', firstName: 'P', lastName: 'C', stage: 'Past Client', lastContactAt: '2026-06-01T00:00:00Z' },
    { ...base, id: 'fu', firstName: 'F', lastName: 'U', stage: 'Nurture', lastContactAt: '2026-11-01T00:00:00Z', nextFollowUpAt: '2026-11-08T12:00:00Z' },
  ];
  const { hot, warm } = hotAndWarm(leads as never, undefined, now);
  assert.deepEqual(hot.map((r) => r.lead.id), ['new']);
  assert.deepEqual(warm.map((r) => r.lead.id), ['fu']);
});

test('pipeline buckets follow the CRM stage', async () => {
  const { bucketFor, groupByBucket } = await import('../src/pipeline.ts');
  assert.equal(bucketFor({ stage: 'Pre-Approved' }), 'preapproved');
  assert.equal(bucketFor({ stage: 'past client' }), null);
  const g = groupByBucket([{ stage: 'In Escrow' }, { stage: 'Contacted' }, { stage: 'Nurture' }]);
  assert.equal(g.escrow.length, 1);
  assert.equal(g.contacted.length, 1);
});

test('Lofty: reads its GMT dates and buyer details', async () => {
  const { mapLoftyLead } = await import('../src/crm/lofty.ts');
  const l = mapLoftyLead({ leadId: 1, createTime: '2026-11-07T01:33:38GMT', lastTouch: '2026-11-07T01:33:44GMT', buyingTimeFrame: '3_to_6_', preQual: 'yes', score: 65, cannotText: true, assignedUserId: 9 } as never);
  assert.equal(l.createdAt, '2026-11-07T01:33:38.000Z');
  assert.equal(l.lastContactAt, '2026-11-07T01:33:44.000Z');
  assert.equal(l.fields.timeline, '3–6 months');
  assert.equal(l.fields.preApproved, true);
  assert.equal(l.fields.crmScore, 65);
  assert.equal(l.fields.doNotText, true);
  assert.equal(l.assignedUserId, '9');
});

test('Lofty: search area, price range and text consent', () => {
  const l = mapLoftyLead({ leadId: 2, leadInquiry: { priceMin: 400000, priceMax: 800000, bedroomsMin: -1, locations: [{ city: 'Fontana' }] }, phoneConsentStates: ['System Recorded consent'] } as never);
  assert.deepEqual(l.fields.areas, ['Fontana']);
  assert.equal(l.fields.budgetMin, 400000);
  assert.equal(l.fields.budgetMax, 800000);
  assert.equal(l.fields.bedsMin, undefined);
  assert.equal(l.fields.textConsent, true);
});

test('nurture: cadence, channel and touch choice', async () => {
  const n = await import('../src/nurture.ts');
  assert.equal(n.cadenceDays({ timeline: '0–3 months' }), 7);
  assert.equal(n.cadenceDays({ timeline: '6–12 months' }), 30);
  assert.equal(n.cadenceDays({}), 21);
  const lead = { phone: '9095550142', email: 'a@b.com', fields: {} };
  assert.equal(n.pickChannel(lead, ['text', 'email']), 'text');
  assert.equal(n.pickChannel(lead, ['text', 'email'], true), 'email'); // auto needs recorded consent to text
  assert.equal(n.pickChannel({ ...lead, fields: { doNotText: true, doNotEmail: true } }, ['text', 'email']), null);
  assert.equal(n.touchKind({}, 0, { home: false, community: false }), 'discovery');
  assert.equal(n.touchKind({ areas: ['Chino'] }, 0, { home: true, community: true }), 'home');
  assert.equal(n.touchKind({ areas: ['Chino'] }, 2, { home: true, community: true }), 'community');
  // No criteria: a hot home from the agent's market is the hook; offers alternate in.
  assert.equal(n.touchKind({}, 0, { home: true, community: false }), 'teaser');
  assert.equal(n.touchKind({}, 1, { home: true, community: false, offer: true }), 'offer');
  assert.equal(n.touchKind({}, 0, { home: false, community: false, offer: true }), 'offer');
  const now = Date.parse('2026-11-09T12:00:00Z');
  assert.equal(n.nurtureEligible({ createdAt: '2026-11-08T12:00:00Z', lastContactAt: null, fields: {}, pinned: false }, now), false);
  assert.equal(n.nurtureEligible({ createdAt: '2026-09-01T12:00:00Z', lastContactAt: '2026-10-01T12:00:00Z', fields: {}, pinned: false }, now), true);
});

test('nurture: rotates discovery questions; normalizes Lofty timeframes', async () => {
  const n = await import('../src/nurture.ts');
  assert.equal(n.nextQuestion({}, 0), 'area');
  assert.equal(n.nextQuestion({}, 1), 'price');
  assert.equal(n.nextQuestion({ areas: ['Chino'] }, 0), 'price');
  assert.equal(n.nextQuestion({ areas: ['Chino'], budgetMax: 700000, timeline: '0–3 months', bedsMin: 3 }, 0), 'open');
  assert.ok(n.DONE_STAGE.test('Closed') && !n.DONE_STAGE.test('Contacted'));
  assert.equal(mapLoftyLead({ leadId: 3, buyingTimeFrame: '3-6' } as never).fields.timeline, '3–6 months');
});

test('nurture: greets by name only when it looks like a name', async () => {
  const n = await import('../src/nurture.ts');
  assert.equal(n.greetableName('Leah'), 'Leah');
  assert.equal(n.greetableName('maria'), 'Maria');
  assert.equal(n.greetableName('Rlpmontanez'), null);
  assert.equal(n.greetableName('Christopher'), 'Christopher');
  assert.equal(n.greetableName('rlpmontanez'), null);
  assert.equal(n.greetableName('jdog_23'), null);
  assert.equal(n.greetableName(''), null);
});

test('pipeline mirrors the CRM: real Lofty stage names, sensible order, done/dead left off', async () => {
  const p = await import('../src/pipeline.ts');
  const board = p.buildPipeline([
    { stage: 'Contacted', n: 252 }, { stage: 'Attempted Contact', n: 59 }, { stage: 'Closed', n: 52 }, { stage: 'New Leads', n: 34 },
    { stage: 'Agent', n: 23 }, { stage: 'Appointment Set', n: 16 }, { stage: 'Call Scheduled', n: 11 }, { stage: 'Already Bought', n: 11 },
    { stage: 'Bad Leads', n: 10 }, { stage: 'Appointment Met', n: 10 }, { stage: 'Sent to Lender', n: 6 }, { stage: 'Do Not Contact', n: 6 },
  ]).map((b) => b.label);
  assert.deepEqual(board, ['New Leads', 'Attempted Contact', 'Contacted', 'Appointment Set', 'Call Scheduled', 'Appointment Met', 'Sent to Lender']);
  assert.deepEqual(p.defaultHotStages(board), ['New Leads', 'Appointment Set', 'Call Scheduled', 'Appointment Met', 'Sent to Lender']);
  assert.equal(p.classifyStage('Under Contract').phase, 7);
  assert.equal(p.classifyStage('Bad Leads').kind, 'dead');
  assert.equal(p.classifyStage('Lender').kind, 'done');
  assert.equal(p.classifyStage('Sent to Lender').kind, 'active');
});

test('closing questions vary by lead', async () => {
  const n = await import('../src/nurture.ts');
  const seen = new Set([0, 1, 2, 3, 4].map((v) => n.closingQuestion('teaser', {}, v, new Date('2026-11-12'))));
  assert.ok(seen.size >= 4);
  assert.match(n.closingQuestion('teaser', {}, 2, new Date('2026-11-12')), /early 2027/);
  assert.equal(n.closingQuestion('discovery', {}, 1), '');
});

test('intro uses the lead source; openers vary', async () => {
  const n = await import('../src/nurture.ts');
  assert.equal(n.introLine('Jeffry Giordano', 'IG Messenger'), 'This is Jeffry, the Realtor from IG');
  assert.equal(n.introLine('Jeffry Giordano', 'Website'), 'This is Jeffry, the Realtor');
  const seen = new Set([0, 7, 14, 21, 28, 35].map((v) => n.openingAngle('teaser', v)));
  assert.equal(seen.size, 6);
});
