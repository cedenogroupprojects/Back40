// Sample data so the app runs before a CRM is connected (and for demos).
// Times are relative to "now" so the ranking always looks realistic.
import type { Agent, BucketId, Draft, Lead } from '@back40/core';

const H = 3_600_000;
const ago = (hours: number) => new Date(Date.now() - hours * H).toISOString();
const ahead = (hours: number) => new Date(Date.now() + hours * H).toISOString();
const todayAt = (h: number) => {
  const d = new Date();
  d.setHours(h, 0, 0, 0);
  return d.toISOString();
};

function lead(p: Partial<Lead> & Pick<Lead, 'id' | 'firstName' | 'lastName' | 'stage'>): Lead {
  return {
    orgId: 'demo-org',
    crm: 'lofty',
    crmLeadId: p.id,
    assignedUserId: 'me',
    tags: [],
    createdAt: ago(24 * 20),
    lastContactAt: ago(30),
    nextFollowUpAt: null,
    signals: [],
    fields: {},
    pinned: false,
    touches: 3,
    timeline: [],
    ...p,
  };
}

export const SAMPLE_LEADS: Lead[] = [
  lead({
    id: 'marisol', firstName: 'Marisol', lastName: 'Vega', stage: 'Actively Looking', phone: '(909) 555-0142', email: 'marisol@example.com',
    source: 'Instagram ad', lastContactAt: ago(72), touches: 6, createdAt: ago(24 * 10),
    signals: [{ kind: 'listing_view', at: ago(14), detail: 'Looked at 3 new homes last night.' }],
    fields: { timeline: 'Lease ends in January', beds: 4, potentialCommission: 16500, purchasePrice: 660000, commissionRate: 2.5 },
    aiWhyNow: 'Looked at 3 new homes last night. Her lease ends in January.',
    aiOpener: 'Want to walk the new phase this weekend?',
    aiSummary: 'Wants a single-story 4 bed in the new phase. Lease ends in January, so she needs to move by then. Started pre-qual with her lender. You promised to call her back Saturday.',
    timeline: [
      { id: 't1', at: ago(14), kind: 'activity', title: 'Looked at 3 homes', body: 'Ontario Ranch, new phase.', source: 'crm' },
      { id: 't2', at: ago(72), kind: 'call', title: 'You called · talked', body: 'Lease ends in Jan. Wants 4 bed, single story. Call back Sat.', source: 'back40', outcome: 'talked' },
      { id: 't3', at: ago(150), kind: 'note', title: 'Note from Lofty', body: 'Started pre-qual with lender.', source: 'crm' },
      { id: 't4', at: ago(240), kind: 'created', title: 'New lead', body: 'Came in from Instagram.', source: 'crm' },
    ],
  }),
  lead({
    id: 'james', firstName: 'James', lastName: 'Carter', stage: 'New Lead', phone: '(909) 555-0177', crm: 'lofty',
    source: 'Website form', createdAt: ago(0.25), lastContactAt: null, touches: 0,
    aiWhyNow: 'Asked about move-in ready homes 14 minutes ago. Be the first to call.',
    aiOpener: 'Thanks for reaching out about the move-in ready homes!',
    timeline: [{ id: 'j1', at: ago(0.25), kind: 'created', title: 'New lead', body: 'Asked about move-in ready homes.', source: 'crm' }],
  }),
  lead({
    id: 'priya', firstName: 'Priya', lastName: 'Shah', stage: 'Sent to Lender', phone: '(626) 555-0101', lastContactAt: ago(48), touches: 4,
    nextFollowUpAt: todayAt(17), promiseNote: 'Call back today about the model home',
    fields: { potentialCommission: 14250, purchasePrice: 570000, commissionRate: 2.5 },
    aiWhyNow: 'You told her you’d call back today about the model home.',
    aiOpener: 'Following up like I promised on the model home.',
    timeline: [{ id: 'p1', at: ago(48), kind: 'call', title: 'You called · talked', body: 'Wants to see the corner lot again with Dev.', source: 'back40', outcome: 'talked' }],
  }),
  lead({
    id: 'tony', firstName: 'Tony', lastName: 'Alvarez', stage: 'Pre-Approved', phone: '(909) 555-0190', crm: 'lofty', lastContactAt: ago(120), touches: 5,
    signals: [{ kind: 'email_reply', at: ago(20), detail: 'Pre-approval came back from the lender.' }],
    fields: { budgetMax: 720000, downPayment: 40000, preApproved: true, potentialCommission: 18000, purchasePrice: 720000, commissionRate: 2.5 },
    aiWhyNow: 'His pre-approval just came back from the lender.',
    aiOpener: 'Congrats on the pre-approval!',
    timeline: [
      { id: 'a1', at: ago(20), kind: 'note', title: 'Note from your ISA', body: 'Pre-approval is in. Wants to tour this week.', source: 'crm' },
      { id: 'a2', at: ago(24 * 5), kind: 'call', title: 'You called · talked', body: 'Budget up to $720K, $40K down.', source: 'back40', outcome: 'talked' },
    ],
  }),
  lead({
    id: 'rachel', firstName: 'Rachel', lastName: 'Nguyen', stage: 'Submitting Offers', phone: '(951) 555-0123', lastContactAt: ago(50), touches: 3,
    signals: [{ kind: 'email_open', at: ago(30), detail: 'Asked about HOA fees at the model home tour.' }],
    fields: { potentialCommission: 12000, purchasePrice: 480000, commissionRate: 2.5 },
    aiWhyNow: 'She asked about HOA fees at the model home tour.',
    timeline: [{ id: 'r1', at: ago(50), kind: 'note', title: 'Tour notes', body: 'Asked about HOA fees.', source: 'back40' }],
  }),
  lead({
    id: 'mike', firstName: 'Mike', lastName: 'Brennan', stage: 'Contacted', phone: '(909) 555-0155', lastContactAt: ago(24 * 9), touches: 7,
    signals: [{ kind: 'listing_view', at: ago(5), detail: 'Quiet for 9 days, but he looked at homes again this morning.' }],
    aiWhyNow: 'Quiet for 9 days, but he looked at homes again this morning.',
    timeline: [{ id: 'm1', at: ago(24 * 9), kind: 'call', title: 'You called · talked', body: 'Waiting on his wife to see it.', source: 'back40', outcome: 'talked' }],
  }),
  lead({
    id: 'carlos', firstName: 'Carlos', lastName: 'Ruiz', stage: 'In Escrow', phone: '(909) 555-0119', lastContactAt: ago(26), touches: 14,
    fields: { potentialCommission: 21000, purchasePrice: 700000, commissionRate: 3 },
    aiSummary: 'In escrow on a 4-bed in the new phase. Appraisal came in on value.',
    timeline: [{ id: 'c1', at: ago(26), kind: 'note', title: 'Escrow update', body: 'Appraisal came in on value. Loan docs next week.', source: 'crm' }],
  }),
  lead({ id: 'nina', firstName: 'Nina', lastName: 'Patel', stage: 'Contacted', phone: '(626) 555-0188', lastContactAt: ago(24 * 6), touches: 4, fields: { potentialCommission: 9000, purchasePrice: 450000, commissionRate: 2 } }),
  lead({ id: 'dana', firstName: 'Dana', lastName: 'Lee', stage: 'Nurture', phone: '(626) 555-0144', lastContactAt: ago(24 * 30), touches: 2 }),
  lead({ id: 'luis', firstName: 'Luis', lastName: 'Ortega', stage: 'Past Client', phone: '(909) 555-0166', lastContactAt: ago(24 * 90), touches: 12 }),
];

export const SAMPLE_DRAFTS: Draft[] = [
  { id: 'd1', leadId: 'james', channel: 'text', play: 'speed_to_lead', status: 'pending', why: 'He asked about move-in ready homes on the form. Nobody has replied yet. First reply usually wins.', body: 'Hi James, it’s Jeffry. Saw you asked about the move-in ready homes. Want me to send what’s available and pricing? I can also show you this weekend.' },
  { id: 'd2', leadId: 'priya', channel: 'text', play: 'no_answer', status: 'pending', why: 'You called yesterday and didn’t reach her. A short text keeps your promise.', body: 'Hi Priya! Tried you earlier about the model home. Is now a good time, or would tomorrow work better?' },
  { id: 'd3', leadId: 'mike', channel: 'text', play: 'back40_sweep', status: 'pending', why: 'He looked at homes again this morning after 9 quiet days.', body: 'Hey Mike, a couple of new homes just opened up that fit what you and your wife were looking for. Want me to send them over?' },
  { id: 'd4', leadId: 'rachel', channel: 'email', play: 'recap', status: 'pending', why: 'She asked about HOA fees at the tour.', subject: 'HOA fees for the homes you toured', body: 'Hi Rachel, great meeting you at the model home. Here’s the HOA breakdown you asked about. Want to set up a second look?' },
];

export const SAMPLE_TEAM: Agent[] = [
  { id: 'sam', name: 'Sam W.', initials: 'SW', role: 'agent', scoreThisWeek: 94, streakDays: 12, staleHotLeads: 0 },
  { id: 'alex', name: 'Alex R.', initials: 'AR', role: 'agent', scoreThisWeek: 88, streakDays: 7, staleHotLeads: 0 },
  { id: 'me', name: 'You', initials: 'JG', role: 'owner', scoreThisWeek: 72, streakDays: 5, staleHotLeads: 0 },
  { id: 'jordan', name: 'Jordan T.', initials: 'JT', role: 'agent', scoreThisWeek: 66, streakDays: 0, staleHotLeads: 1 },
  { id: 'dana', name: 'Dana M.', initials: 'DM', role: 'agent', scoreThisWeek: 58, streakDays: 0, staleHotLeads: 1 },
  { id: 'chris', name: 'Chris P.', initials: 'CP', role: 'agent', scoreThisWeek: 41, streakDays: 0, staleHotLeads: 2 },
];

/** Calls per day this week, Mon → Sun (today's bar is live). */
export const SAMPLE_WEEK = [5, 8, 4, 9, 6];

export const STAGES = ['New Lead', 'Contacted', 'Sent to Lender', 'Pre-Approved', 'Actively Looking', 'Submitting Offers', 'In Escrow', 'Nurture', 'Past Client'];

/** Admin panel demo: how many leads each agent has in each pipeline bucket, and their stale hot leads. */
export const SAMPLE_TEAM_PIPELINE: Record<string, { buckets: Record<BucketId, number>; commission: number; stale: { name: string; days: number; bucket: BucketId }[] }> = {
  sam: { buckets: { new: 3, contacted: 14, lender: 5, preapproved: 4, looking: 6, offers: 2, escrow: 2 }, commission: 168000, stale: [] },
  alex: { buckets: { new: 2, contacted: 11, lender: 4, preapproved: 3, looking: 4, offers: 1, escrow: 1 }, commission: 112500, stale: [] },
  me: { buckets: { new: 1, contacted: 2, lender: 1, preapproved: 1, looking: 1, offers: 1, escrow: 1 }, commission: 75750, stale: [] },
  jordan: { buckets: { new: 4, contacted: 16, lender: 3, preapproved: 2, looking: 3, offers: 1, escrow: 0 }, commission: 84000, stale: [{ name: 'Kevin Moore', days: 3, bucket: 'looking' }] },
  dana: { buckets: { new: 2, contacted: 8, lender: 2, preapproved: 2, looking: 2, offers: 0, escrow: 1 }, commission: 61000, stale: [{ name: 'Lisa Tran', days: 4, bucket: 'offers' }] },
  chris: { buckets: { new: 5, contacted: 9, lender: 3, preapproved: 1, looking: 3, offers: 1, escrow: 0 }, commission: 72000, stale: [{ name: 'Omar Haddad', days: 2, bucket: 'new' }, { name: 'Beth Cole', days: 5, bucket: 'preapproved' }] },
};
