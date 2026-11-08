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
  const many = Array.from({ length: 14 }, (_, i) => lead({ id: `h${i}`, stage: 'Actively Looking', signals: [{ kind: 'site_visit', at: hoursAgo(i + 1) }] }));
  const pinned = lead({ id: 'pin', pinned: true });
  const list = rankToday([...many, pinned], DEFAULT_RULES, NOW);
  assert.ok(list.some((r) => r.lead.id === 'pin'));
  assert.ok(list.length <= 11);
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

test('non-hot, inactive lead stays off Today', () => {
  assert.equal(rankToday([lead({ id: 'quiet' })], DEFAULT_RULES, NOW).length, 0);
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
