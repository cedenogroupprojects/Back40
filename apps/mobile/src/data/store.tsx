// App state. Two modes:
// - demo: sample data, everything local (the tappable preview).
// - live: signed in to Back 40; leads come from the database (synced from the
//   CRM) and every edit goes through the server, which writes it to the CRM.
// Screens only talk to this store, so they don't care which mode is on.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  DEFAULT_RULES,
  LABEL_TEXT,
  dailyScore,
  pointsFor,
  rankToday,
  buildPipeline,
  defaultHotStages,
  PIPELINE,
  stageOptions,
  type Bucket,
  staleHotLeads,
  type CallOutcome,
  type CrmKind,
  type Draft,
  type HotRules,
  type Lead,
  type LeadFields,
  type RankedLead,
  type TimelineItem,
} from '@back40/core';

import { SAMPLE_DRAFTS, SAMPLE_LEADS, SAMPLE_TEAM, SAMPLE_WEEK } from './sample';
import * as live from './supabase';

export type Status = 'loading' | 'signed_out' | 'needs_crm' | 'ready' | 'demo';

export type Role = 'owner' | 'admin' | 'agent' | 'solo';

export type Nudge = { id: string; kind: 'new_lead' | 'morning' | 'cold' | 'crm'; title: string; body: string; when: string; leadId?: string };

export type Settings = {
  name: string;
  initials: string;
  role: Role;
  dailyGoal: number;
  crm: CrmKind | null;
  rules: HotRules;
  morningListAt: string;
  nudges: Record<'new_lead' | 'morning' | 'promise' | 'cold' | 'crm' | 'streak', boolean>;
  voiceProfile: boolean;
  autopilotNurture: boolean;
};

type CallInput = { leadId: string; outcome: CallOutcome; note?: string; fields?: Partial<LeadFields>; followUpAt?: string | null; stageChange?: string | null };

type Store = {
  status: Status;
  isLiveMode: boolean;
  profile: live.Profile | null;
  notice: string | null;
  clearNotice: () => void;
  enterDemo: () => void;
  reload: () => Promise<void>;
  loadTimeline: (id: string) => Promise<void>;
  signOut: () => Promise<void>;
  settings: Settings;
  onboarded: boolean;
  leads: Lead[];
  today: RankedLead[];
  /** The team's own CRM stages as board columns (sample columns in demo). */
  pipeline: Bucket[];
  /** Every stage the team uses, for stage pickers (board first, then done/dead). */
  stages: string[];
  drafts: Draft[];
  nudges: Nudge[];
  team: typeof SAMPLE_TEAM;
  week: number[];
  callsToday: number;
  score: number;
  streak: number;
  stale: Lead[];
  lead: (id: string) => Lead | undefined;
  labelText: typeof LABEL_TEXT;
  logCall: (c: CallInput) => number;
  togglePin: (id: string) => void;
  updateLead: (id: string, patch: Partial<Pick<Lead, 'stage' | 'tags' | 'nextFollowUpAt'>>) => void;
  setCommission: (id: string, amount: number | null, basis?: { price: number; rate: number }) => void;
  addNote: (id: string, body: string) => void;
  /** Add a lead by hand. Returns the new lead's id (or throws with a readable message). */
  addLead: (input: NewLead) => Promise<string>;
  sendMessage: (leadId: string, channel: 'text' | 'email', body: string, opts?: { subject?: string; fromPhone?: boolean }) => void;
  decideDraft: (id: string, decision: 'sent' | 'skipped', body?: string) => void;
  /** Swap the home on a nurture message; the message is rewritten around it. */
  swapHome: (draftId: string, homeId: string) => Promise<void>;
  reassign: (fromAgentId: string) => void;
  updateSettings: (patch: Partial<Settings>) => void;
  finishOnboarding: (patch: Partial<Settings>) => void;
};

export type NewLead = { firstName: string; lastName?: string; phone?: string; email?: string; stage: string; notes?: string };

const Ctx = createContext<Store | null>(null);

const DEFAULT_SETTINGS: Settings = {
  name: '',
  initials: '',
  role: 'owner',
  dailyGoal: 6,
  crm: 'lofty',
  rules: DEFAULT_RULES,
  morningListAt: '7:30 AM',
  nudges: { new_lead: true, morning: true, promise: true, cold: true, crm: true, streak: true },
  voiceProfile: false,
  autopilotNurture: false,
};

export function StoreProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>(live.isLive ? 'loading' : 'demo');
  const [profile, setProfile] = useState<live.Profile | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>(live.isLive ? DEFAULT_SETTINGS : { ...DEFAULT_SETTINGS, name: 'Taylor', initials: 'TM' });
  const [onboarded, setOnboarded] = useState(true);
  const [leads, setLeads] = useState<Lead[]>(live.isLive ? [] : SAMPLE_LEADS);
  const [drafts, setDrafts] = useState<Draft[]>(live.isLive ? [] : SAMPLE_DRAFTS);
  const [team, setTeam] = useState(SAMPLE_TEAM);
  const [teamStages, setTeamStages] = useState<{ stage: string; n: number }[]>([]);
  const [calls, setCalls] = useState<{ outcome: CallOutcome; speedToLead?: boolean }[]>(live.isLive ? [] : [{ outcome: 'talked' }]);
  const [weekLive, setWeekLive] = useState<number[] | null>(null);
  const isLiveMode = status !== 'demo';
  const liveRef = useRef(false);
  liveRef.current = isLiveMode && status === 'ready';

  /** Fire a server write; on failure keep the local change and tell the user. */
  const remote = (p: Promise<unknown>) => {
    if (!liveRef.current) return;
    p.catch((e: Error) => setNotice(e.message || 'Could not save to your CRM. We will retry.'));
  };

  const reload = useCallback(async () => {
    if (!live.isLive) return;
    try {
      const session = await live.getSession();
      if (!session) {
        setStatus((s) => (s === 'demo' ? s : 'signed_out'));
        return;
      }
      let p = await live.fetchProfile();
      if (!p) {
        // Signed up but the team step didn't finish: finish it now.
        const name = (session.user.user_metadata?.name as string) || session.user.email?.split('@')[0] || 'Agent';
        await live.supabase().rpc('create_team', { team_name: '', display_name: name });
        p = await live.fetchProfile();
      }
      if (!p) throw new Error('Could not load your team.');
      setProfile(p);
      const parts = p.name.split(/\s+/);
      setSettings((s) => ({
        ...s,
        name: parts[0] ?? p!.name,
        initials: `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}`.toUpperCase() || 'ME',
        role: p!.role,
        dailyGoal: p!.dailyGoal,
        crm: p!.crm?.kind ?? null,
        rules: { ...s.rules, hotStages: p!.hotStages.length ? p!.hotStages : s.rules.hotStages },
      }));
      // No CRM is fine: hand-added leads still load, and Today offers to connect one.
      const monday = new Date();
      monday.setHours(0, 0, 0, 0);
      monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
      const [ls, ds, cs, ts] = await Promise.all([live.fetchLeads(p.userId), live.fetchDrafts(p.userId), live.fetchCallsSince(p.userId, monday.toISOString()), live.fetchTeamStages()]);
      setLeads(ls);
      setTeamStages(ts);
      // Hot stages follow the team's real CRM stages. If none of the saved ones exist
      // (new team, or names that don't match this CRM), pick sensible ones automatically.
      const names = ts.map((t) => t.stage);
      const saved = p.hotStages.filter((h) => names.some((n) => n.toLowerCase() === h.toLowerCase()));
      if (names.length && !saved.length) {
        const auto = defaultHotStages(names);
        setSettings((s) => ({ ...s, rules: { ...s.rules, hotStages: auto } }));
        if (p.role !== 'agent') void live.updateTeamSettings(p.orgId, { hot_stages: auto }).catch(() => undefined);
      }
      setDrafts(ds);
      const days = [0, 0, 0, 0, 0, 0, 0];
      for (const c of cs) days[(new Date(c.created_at).getDay() + 6) % 7]! += 1;
      const todayIdx = (new Date().getDay() + 6) % 7;
      setWeekLive(days.slice(0, todayIdx + 1));
      setCalls(cs.filter((c) => new Date(c.created_at).toDateString() === new Date().toDateString()).map((c) => ({ outcome: c.outcome as CallOutcome })));
      setStatus('ready');
    } catch (e) {
      setNotice((e as Error).message);
      setStatus((s) => (s === 'loading' ? 'signed_out' : s));
    }
  }, []);

  // Sign-in state drives everything in live mode.
  useEffect(() => {
    if (!live.isLive) return;
    void reload();
    const sub = live.onAuthChange((session) => {
      if (session) void reload();
      else setStatus((s) => (s === 'demo' ? s : 'signed_out'));
    });
    return () => sub.unsubscribe();
  }, [reload]);

  // CRM changes stream in while the app is open.
  useEffect(() => {
    if (status !== 'ready') return;
    let t: ReturnType<typeof setTimeout> | null = null;
    const unsub = live.subscribeToLeads(() => {
      if (t) clearTimeout(t);
      t = setTimeout(() => void reload(), 1500);
    });
    return () => {
      if (t) clearTimeout(t);
      unsub();
    };
  }, [status, reload]);

  const enterDemo = () => {
    setLeads(SAMPLE_LEADS);
    setDrafts(SAMPLE_DRAFTS);
    setSettings((s) => ({ ...s, name: 'Taylor', initials: 'TM' })); // sample agent, never a real person
    setCalls([{ outcome: 'talked' }]);
    setWeekLive(null);
    setStatus('demo');
  };

  const signOut = async () => {
    if (live.isLive) await live.signOut().catch(() => undefined);
    setLeads([]);
    setProfile(null);
    setStatus(live.isLive ? 'signed_out' : 'demo');
  };

  const loadTimeline = useCallback(async (id: string) => {
    if (!liveRef.current) return;
    const items = await live.fetchTimeline(id).catch(() => null);
    if (items) setLeads((ls) => ls.map((l) => (l.id === id ? { ...l, timeline: items } : l)));
  }, []);

  const now = Date.now();
  const today = useMemo(() => rankToday(leads, settings.rules, now), [leads, settings.rules, now]);
  // Board columns: the team's CRM stages plus any stage this agent's leads are in.
  const pipeline = useMemo(() => {
    if (!isLiveMode) return PIPELINE;
    const counts = new Map<string, number>();
    for (const t of teamStages) counts.set(t.stage, t.n);
    for (const l of leads) if (!counts.has(l.stage)) counts.set(l.stage, 1);
    const built = buildPipeline([...counts].map(([stage, n]) => ({ stage, n })));
    return built.length ? built : PIPELINE;
  }, [isLiveMode, teamStages, leads]);
  const stages = useMemo(() => (isLiveMode && (teamStages.length || leads.length) ? stageOptions([...teamStages.map((t) => t.stage), ...leads.map((l) => l.stage)]) : PIPELINE.map((b) => b.stage)), [isLiveMode, teamStages, leads]);
  const stale = useMemo(() => staleHotLeads(leads, settings.rules, now), [leads, settings.rules, now]);
  const score = dailyScore({ date: '', calls, staleHotLeads: 0 }, settings.dailyGoal);

  const nudges: Nudge[] = useMemo(() => {
    const out: Nudge[] = [];
    const newest = today.find((r) => r.label === 'brand_new');
    if (newest) out.push({ id: 'n1', kind: 'new_lead', title: 'New lead', body: `${newest.lead.firstName} ${newest.lead.lastName} just came in. Nobody has called yet.`, when: 'Just now', leadId: newest.lead.id });
    out.push({ id: 'n2', kind: 'morning', title: 'Your morning list', body: (() => { const h = today.filter((r) => ['brand_new', 'hot_now', 'promised', 'slipping'].includes(r.label)).length; return `${today.length} people to call today. ${h} ${h === 1 ? 'is' : 'are'} hot.`; })(), when: settings.morningListAt });
    const cold = today.find((r) => r.label === 'slipping' || r.label === 'back_again');
    if (cold) out.push({ id: 'n3', kind: 'cold', title: cold.label === 'back_again' ? 'Back on the market' : 'Slipping away', body: cold.reason, when: 'Yesterday', leadId: cold.lead.id });
    if (status === 'demo') out.push({ id: 'n4', kind: 'crm', title: 'From your CRM', body: 'Your ISA added a note to Tony Alvarez: pre-approval is in.', when: 'Yesterday', leadId: 'tony' });
    return out;
  }, [today, settings.morningListAt, status]);

  const lead = useCallback((id: string) => leads.find((l) => l.id === id), [leads]);

  const pushTimeline = (id: string, item: Omit<TimelineItem, 'id' | 'at' | 'source'>) =>
    setLeads((ls) => ls.map((l) => (l.id === id ? { ...l, timeline: [{ id: `${Date.now()}`, at: new Date().toISOString(), source: 'back40', ...item }, ...l.timeline] } : l)));

  const logCall = useCallback((c: CallInput) => {
    const target = leads.find((l) => l.id === c.leadId);
    const speed = !!target && !target.lastContactAt && Date.now() - Date.parse(target.createdAt) < 15 * 60_000 && c.outcome === 'talked';
    setCalls((cs) => [...cs, { outcome: c.outcome, speedToLead: speed }]);
    setLeads((ls) =>
      ls.map((l) =>
        l.id !== c.leadId
          ? l
          : {
              ...l,
              lastContactAt: new Date().toISOString(),
              nextFollowUpAt: c.followUpAt ?? null,
              promiseNote: undefined,
              stage: c.stageChange ?? l.stage,
              fields: { ...l.fields, ...(c.fields ?? {}) },
              touches: l.touches + 1,
              signals: [],
              timeline: [
                { id: `${Date.now()}`, at: new Date().toISOString(), kind: 'call', source: 'back40', outcome: c.outcome, title: `You called · ${c.outcome === 'talked' ? 'talked' : c.outcome === 'voicemail' ? 'voicemail' : 'no answer'}`, body: c.note },
                ...l.timeline,
              ],
            },
      ),
    );
    remote(live.logCallRemote({ leadId: c.leadId, outcome: c.outcome, note: c.note, extracted: c.fields && Object.keys(c.fields).length ? c.fields : undefined, followUpAt: c.followUpAt ?? undefined, stageChange: c.stageChange ?? undefined, speedToLead: speed }));
    return pointsFor(c.outcome, speed);
  }, [leads]);

  const togglePin = (id: string) => {
    const was = leads.find((l) => l.id === id)?.pinned;
    setLeads((ls) => ls.map((l) => (l.id === id ? { ...l, pinned: !l.pinned } : l)));
    remote(live.leadAction(id, 'pin', { pinned: !was }));
  };

  const addLead: Store['addLead'] = async (input) => {
    if (liveRef.current) {
      const r = (await live.leadAction('', 'create', { lead: input })) as unknown as { id: string };
      if (profile) setLeads(await live.fetchLeads(profile.userId));
      return r.id;
    }
    const now = new Date().toISOString();
    const id = `local-${Date.now()}`;
    const lead: Lead = {
      id, orgId: 'demo', crm: 'manual', crmLeadId: id, assignedUserId: null,
      firstName: input.firstName.trim(), lastName: (input.lastName ?? '').trim(),
      phone: input.phone?.trim() || undefined, email: input.email?.trim() || undefined,
      stage: input.stage, source: 'Added in Back 40', tags: [], createdAt: now,
      lastContactAt: null, nextFollowUpAt: null, signals: [], fields: {}, pinned: false, touches: 0,
      timeline: [{ id: `${Date.now()}`, at: now, kind: 'note', title: 'Added in Back 40', body: input.notes?.trim() || undefined, source: 'back40' }],
    };
    setLeads((ls) => [lead, ...ls]);
    return id;
  };

  const updateLead: Store['updateLead'] = (id, patch) => {
    setLeads((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
    if (patch.stage) {
      pushTimeline(id, { kind: 'stage', title: `Stage → ${patch.stage}` });
      remote(live.leadAction(id, 'stage', { stage: patch.stage }));
    }
  };

  const setCommission: Store['setCommission'] = (id, amount, basis) => {
    setLeads((ls) =>
      ls.map((l) => {
        if (l.id !== id) return l;
        const fields = { ...l.fields };
        if (amount && amount > 0) {
          fields.potentialCommission = Math.round(amount);
          if (basis) {
            fields.purchasePrice = basis.price;
            fields.commissionRate = basis.rate;
          }
        } else {
          delete fields.potentialCommission;
          delete fields.purchasePrice;
          delete fields.commissionRate;
        }
        return { ...l, fields };
      }),
    );
    if (!liveRef.current) pushTimeline(id, { kind: 'note', title: amount ? `Potential commission: $${Math.round(amount).toLocaleString('en-US')}` : 'Potential commission cleared' });
    remote(live.leadAction(id, 'commission', { amount, price: basis?.price, rate: basis?.rate }));
  };

  const addNote = (id: string, body: string) => {
    pushTimeline(id, { kind: 'note', title: 'Note', body });
    remote(live.leadAction(id, 'note', { body }));
  };

  const sendMessage: Store['sendMessage'] = (leadId, channel, body, opts) => {
    pushTimeline(leadId, { kind: channel, title: channel === 'text' ? 'You texted' : 'You emailed', body });
    setLeads((ls) => ls.map((l) => (l.id === leadId ? { ...l, lastContactAt: new Date().toISOString(), touches: l.touches + 1 } : l)));
    remote(live.leadAction(leadId, 'message', { channel, body, subject: opts?.subject, sentFromPhone: opts?.fromPhone }));
  };

  const decideDraft: Store['decideDraft'] = (id, decision, body) => {
    const d = drafts.find((x) => x.id === id);
    setDrafts((ds) => ds.map((x) => (x.id === id ? { ...x, status: decision, body: body ?? x.body } : x)));
    if (d && decision === 'sent') sendMessage(d.leadId, d.channel, body ?? d.body, { subject: d.subject });
    if (liveRef.current) remote(Promise.resolve(live.supabase().from('drafts').update({ status: decision === 'sent' ? (body ? 'edited_sent' : 'sent') : 'skipped', decided_at: new Date().toISOString() }).eq('id', id)));
  };

  const swapHome: Store['swapHome'] = async (draftId, homeId) => {
    const d = drafts.find((x) => x.id === draftId);
    const home = d?.homeOptions?.find((h) => h.id === homeId);
    if (!d || !home) return;
    if (!liveRef.current) {
      setDrafts((ds) => ds.map((x) => (x.id === draftId ? { ...x, home } : x)));
      return;
    }
    const next = await live.swapHome(draftId, homeId);
    setDrafts((ds) => ds.map((x) => (x.id === draftId ? { ...x, body: next.body, subject: next.subject ?? undefined, why: next.why, home: next.home } : x)));
  };

  const reassign = (fromAgentId: string) =>
    setTeam((t) => t.map((a) => (a.id === fromAgentId ? { ...a, staleHotLeads: 0 } : a.id === 'sam' ? { ...a, staleHotLeads: a.staleHotLeads } : a)));

  const updateSettings = (patch: Partial<Settings>) => {
    setSettings((s) => ({ ...s, ...patch }));
    if (liveRef.current && profile && profile.role !== 'agent' && (patch.dailyGoal || patch.rules)) {
      remote(live.updateTeamSettings(profile.orgId, { daily_goal: patch.dailyGoal, hot_stages: patch.rules?.hotStages }));
    }
  };

  const finishOnboarding = (patch: Partial<Settings>) => {
    updateSettings(patch);
    setOnboarded(true);
  };

  const week = weekLive ?? [...SAMPLE_WEEK, calls.length];
  let streak = 0;
  if (weekLive) {
    for (let i = weekLive.length - 1; i >= 0; i--) {
      if (weekLive[i]! >= settings.dailyGoal) streak++;
      else if (i !== weekLive.length - 1) break;
    }
  } else streak = 5;

  const value: Store = {
    status, isLiveMode, profile, notice, clearNotice: () => setNotice(null), enterDemo, reload, loadTimeline, signOut,
    settings, onboarded, leads, today, pipeline, stages, drafts, nudges, team, stale, lead,
    week,
    callsToday: calls.length,
    score,
    streak,
    labelText: LABEL_TEXT,
    logCall, togglePin, updateLead, setCommission, addNote, addLead, sendMessage, decideDraft, swapHome, reassign, updateSettings, finishOnboarding,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore outside StoreProvider');
  return s;
}

export function initials(l: Pick<Lead, 'firstName' | 'lastName'>) {
  return `${l.firstName[0] ?? ''}${l.lastName[0] ?? ''}`.toUpperCase();
}

export function relTime(iso: string | null) {
  if (!iso) return 'never';
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (mins < 60) return `${Math.max(1, mins)} min ago`;
  if (mins < 1440) return `${Math.round(mins / 60)} hr ago`;
  const d = Math.round(mins / 1440);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

/** $18,000 → "$18K", $1,250,000 → "$1.25M". */
export function money(n: number, short = true) {
  if (!short || n < 1000) return `$${Math.round(n).toLocaleString('en-US')}`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n % 1_000_000 ? 2 : 0).replace(/\.?0+$/, '')}M`;
  return `$${(n / 1000).toFixed(n % 1000 >= 100 ? 1 : 0).replace(/\.0$/, '')}K`;
}
