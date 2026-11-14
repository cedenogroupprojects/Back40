// Follow up — every message Back 40 wrote for the agent's leads, one at a time.
// Each is written for that person (their notes, history and the deal homes that
// fit them), never a template. Send, edit, pick a different home, or skip.
// Lives in its own tab and as the /approve sheet.
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Image, Linking, Pressable, TextInput, View } from 'react-native';

import { BADGE_TEXT, type Draft, type HomeCard } from '@back40/core';

import { Icon } from '@/components/Icon';
import { Avatar, Card, IconButton, Pill, Row, Screen, T, NavBar, List, ListRow, SectionLabel } from '@/components/ui';
import { initials, money, useStore } from '@/data/store';
import * as live from '@/data/supabase';
import { CRM_CAN_SEND, SOURCE_NAME } from '@/lib/crm';
import { openOnPhone } from '@/lib/phone';
import { useTheme } from '@/theme/ThemeProvider';
import { font } from '@/theme/tokens';

const PLAY: Record<string, string> = { speed_to_lead: 'Brand new lead', no_answer: 'Didn’t answer', back40_sweep: 'Back on the market', recap: 'Follow-up', ask: 'You asked', nurture: 'Keeping in touch' };

/** The home or community a nurture message features. Tap to open the listing. */
function Home({ h }: { h: HomeCard }) {
  const { c } = useTheme();
  const price = h.price ? money(h.price, false) : h.priceFrom ? `From ${money(h.priceFrom, false)}` : null;
  const facts = [price, h.beds ? `${h.beds} bd` : null, h.baths ? `${h.baths} ba` : null].filter(Boolean).join(' · ');
  const body = (
    <Row gap={12} style={{ backgroundColor: c.soft, borderRadius: 4, padding: 10 }}>
      {h.photo ? (
        <Image source={{ uri: h.photo }} style={{ width: 64, height: 64, borderRadius: 4, backgroundColor: c.track }} accessibilityIgnoresInvertColors />
      ) : (
        <View style={{ width: 64, height: 64, borderRadius: 4, backgroundColor: c.card, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={h.kind === 'community' ? 'board' : 'today'} size={24} color={c.sub} />
        </View>
      )}
      <View style={{ flex: 1, gap: 2 }}>
        <T size={11} w="semibold" tone={h.badge ? 'accent' : 'sub'}>
          {h.kind === 'community' ? 'NEW-BUILD COMMUNITY' : h.badge ? BADGE_TEXT[h.badge].toUpperCase() : 'HOME THAT FITS'}
        </T>
        <T w="semibold" size={15} numberOfLines={1}>
          {h.title}
        </T>
        <T size={13} tone="sub" numberOfLines={1}>
          {[h.kind === 'community' ? h.subtitle : null, h.city, facts].filter(Boolean).join(' · ')}
        </T>
      </View>
      {h.url ? <Icon name="chevron" size={15} color={c.sub} width={2.2} /> : null}
    </Row>
  );
  return h.url ? (
    <Pressable accessibilityRole="link" accessibilityLabel={`Open ${h.title}`} onPress={() => void Linking.openURL(h.url!)}>
      {body}
    </Pressable>
  ) : (
    body
  );
}

/**
 * Change the home on any waiting message: pick from the options, pull different
 * ones, add a home to a message that has none, or send it without a home.
 */
function HomeSwap({ draft, onChanged }: { draft: Draft; onChanged: () => void }) {
  const { c } = useTheme();
  const { swapHome, findHomes, dropHome } = useStore();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null); // a home id, 'find', 'more' or 'none'
  const [err, setErr] = useState<string | null>(null);
  const options = (draft.homeOptions ?? []).filter((h) => h.kind === 'listing');
  const current = draft.home?.id;

  const run = async (key: string, job: () => Promise<string | null | void>) => {
    if (busy) return;
    setBusy(key);
    setErr(null);
    try {
      const msg = await job();
      if (msg) setErr(msg);
      return !msg;
    } catch (e) {
      setErr((e as Error).message);
      return false;
    } finally {
      setBusy(null);
    }
  };
  const toggle = async () => {
    if (open) return setOpen(false);
    setOpen(true);
    if (options.length < 2) await run('find', () => findHomes(draft.id));
  };
  const pick = async (id: string) => {
    if (id === current) return;
    if (await run(id, () => swapHome(draft.id, id))) {
      setOpen(false);
      onChanged();
    }
  };
  const none = async () => {
    if (await run('none', () => dropHome(draft.id))) {
      setOpen(false);
      onChanged();
    }
  };

  return (
    <View style={{ gap: 10 }}>
      <Pressable
        accessibilityRole="button"
        onPress={() => void toggle()}
        style={({ pressed }) => ({ minHeight: 48, borderRadius: 4, borderWidth: 1.5, borderColor: open ? c.text : c.sep, backgroundColor: c.card, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: pressed ? 0.7 : 1 })}>
        <Icon name={open ? 'close' : current ? 'board' : 'plus'} size={17} color={c.text} width={2.2} />
        <T w="bold" size={15}>
          {open ? 'Keep it as is' : current ? 'Swap home' : 'Add a home'}
        </T>
      </Pressable>
      {open ? (
        <View style={{ gap: 8 }}>
          {busy === 'find' || busy === 'more' ? (
            <Row gap={10} style={{ paddingVertical: 14, justifyContent: 'center' }}>
              <ActivityIndicator color={c.sub} />
              <T size={14} tone="sub">
                Checking your MLS for homes that fit…
              </T>
            </Row>
          ) : (
            options.map((h) => {
              const on = h.id === current;
              const facts = [h.price ? money(h.price, false) : null, h.beds ? `${h.beds} bd` : null, h.baths ? `${h.baths} ba` : null, h.sqft ? `${h.sqft.toLocaleString('en-US')} sqft` : null].filter(Boolean).join(' · ');
              return (
                <Pressable key={h.id} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={`Use ${h.title}`} onPress={() => void pick(h.id)}>
                  <Row gap={12} style={{ borderRadius: 4, padding: 10, backgroundColor: on ? c.soft : c.card, borderWidth: 1.5, borderColor: on ? c.text : c.sep }}>
                    {h.photo ? (
                      <Image source={{ uri: h.photo }} style={{ width: 72, height: 72, borderRadius: 4, backgroundColor: c.track }} accessibilityIgnoresInvertColors />
                    ) : (
                      <View style={{ width: 72, height: 72, borderRadius: 4, backgroundColor: c.soft }} />
                    )}
                    <View style={{ flex: 1, gap: 2 }}>
                      {h.badge ? (
                        <T size={11} w="semibold" tone="accent">
                          {BADGE_TEXT[h.badge].toUpperCase()}
                          {h.badge === 'new' && h.daysOnMarket != null ? ` · ${h.daysOnMarket === 0 ? 'today' : `${h.daysOnMarket}d`}` : ''}
                        </T>
                      ) : null}
                      <T w="semibold" size={15} numberOfLines={1}>
                        {h.title}
                      </T>
                      <T size={13} tone="sub" numberOfLines={1}>
                        {[h.city, facts].filter(Boolean).join(' · ')}
                      </T>
                    </View>
                    {busy === h.id ? <ActivityIndicator color={c.sub} /> : on ? <Icon name="check" size={18} color={c.text} /> : null}
                  </Row>
                </Pressable>
              );
            })
          )}
          {err ? (
            <T size={13} tone="accent">
              {err}
            </T>
          ) : options.length && !busy ? (
            <T size={12} tone="sub">
              Tap a home and the message rewrites itself around it.
            </T>
          ) : null}
          <Row gap={8}>
            {options.length ? (
              <Pill label={busy === 'more' ? 'Looking…' : 'Show different homes'} kind="soft" size="sm" disabled={!!busy} onPress={() => void run('more', () => findHomes(draft.id, true))} style={{ flex: 1 }} />
            ) : null}
            {current ? <Pill label={busy === 'none' ? 'Rewriting…' : 'No home'} kind="soft" size="sm" disabled={!!busy} onPress={() => void none()} style={{ flex: 1 }} /> : null}
          </Row>
        </View>
      ) : null}
    </View>
  );
}

export function FollowUpQueue({ inTab = false }: { inTab?: boolean }) {
  const { c } = useTheme();
  const { drafts, lead: get, decideDraft, canSendCrm } = useStore();
  // Through the CRM a text goes out from the key owner's number, so it only sends
  // that way with your own key; otherwise it opens your phone with the text ready.
  const viaCrm = (leadCrm?: string) => canSendCrm && !!leadCrm && !!CRM_CAN_SEND[leadCrm as keyof typeof CRM_CAN_SEND];
  const pending = drafts.filter((d) => d.status === 'pending');
  const total = drafts.length;
  const d = pending[0];
  const lead = d ? get(d.leadId) : undefined;
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState('');
  // Three versions per lead; which one is showing for each draft.
  const [picks, setPicks] = useState<Record<string, number>>({});
  const versions = d ? (d.alternatives?.length ? d.alternatives : [{ body: d.body, subject: d.subject, why: d.why }]) : [];
  const pick = d ? Math.min(picks[d.id] ?? 0, Math.max(0, versions.length - 1)) : 0;
  const shown = versions[pick];
  const [confirmAll, setConfirmAll] = useState(false);
  const { reload, isLiveMode } = useStore();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const writeNow = async () => {
    if (!isLiveMode) return setNote('Sign in to have Back 40 write follow-ups for your leads.');
    setBusy(true);
    setNote(null);
    try {
      const r = await live.runNurtureNow(10);
      await reload();
      setNote(r.drafted ? null : 'Nobody is due for a follow-up right now. New ones come tomorrow morning.');
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  // Right before anything goes out, make sure its home is still on the market.
  const [held, setHeld] = useState<Record<string, string>>({});
  const stillAvailable = async (id: string, hasListing: boolean) => {
    if (!isLiveMode || !hasListing) return true;
    const r = await live.verifyDraft(id).catch(() => ({ ok: true as const }));
    if (r.ok) return true;
    setHeld((h) => ({ ...h, [id]: r.error ?? 'This home is no longer available. Pick a different home.' }));
    return false;
  };
  const [sending, setSending] = useState(false);
  const sendOne = async (id: string, edited?: string) => {
    const x = pending.find((p) => p.id === id);
    if (!x) return;
    setSending(true);
    const ok = await stillAvailable(id, x.home?.kind === 'listing');
    setSending(false);
    if (!ok) return;
    const l = get(x.leadId);
    if (!viaCrm(l?.crm)) {
      await openOnPhone(x.channel, x.channel === 'email' ? l?.email : l?.phone, edited ?? x.body, x.subject ?? '');
      decideDraft(id, 'sent', edited, { fromPhone: true });
    } else decideDraft(id, 'sent', edited);
    setEditing(false);
  };
  const sendAll = async () => {
    if (!confirmAll) return setConfirmAll(true);
    setConfirmAll(false);
    setSending(true);
    for (const x of pending) {
      if (await stillAvailable(x.id, x.home?.kind === 'listing')) decideDraft(x.id, 'sent');
    }
    setSending(false);
  };

  return (
    <Screen
      bottomSpace={inTab ? 100 : 40}
      title={inTab ? 'Follow up' : undefined}
      kicker={inTab ? (pending.length ? `${pending.length} ready · written for each person` : 'Personal follow-ups for your leads') : undefined}
      right={inTab ? <IconButton icon="sparkle" label="Follow-up settings" onPress={() => router.push('/nurture')} /> : undefined}>
      {inTab ? null : <NavBar title={d ? `${total - pending.length + 1} of ${total}` : 'Messages'} onClose={() => router.back()} closeLabel="Done" />}
      {!d || !lead ? (
        <View style={{ gap: 12, paddingTop: 40, alignItems: 'center' }}>
          <Icon name="check" size={40} color={c.good} />
          <T w="bold" size={22}>
            All caught up
          </T>
          <T tone="body" style={{ textAlign: 'center', paddingHorizontal: 20 }}>
            Back 40 writes new follow-ups every morning, each one for that person, with deal homes when they fit.
          </T>
          {inTab ? (
            <Pill label={busy ? 'Writing…' : 'Write today’s now'} kind="primary" onPress={writeNow} disabled={busy} />
          ) : (
            <Pill label="Back to Today" kind="ink" onPress={() => router.back()} />
          )}
          {note ? (
            <T size={13} tone="sub">
              {note}
            </T>
          ) : null}
        </View>
      ) : (
        <>
          {inTab ? null : (
            <>
              <T w="bold" size={28} style={{ paddingHorizontal: 4 }}>
                {pending.length} to send
              </T>
              <T size={14} tone="sub" style={{ paddingHorizontal: 4, marginTop: -6 }}>
                Written for each person from their notes and history. Send, edit or skip.
              </T>
            </>
          )}
          <Card style={{ gap: 14 }}>
            <Row gap={12}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Open ${lead.firstName} ${lead.lastName}'s card`}
                onPress={() => router.push(`/lead/${lead.id}`)}
                style={({ pressed }) => ({ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, opacity: pressed ? 0.6 : 1 })}>
                <Avatar initials={initials(lead)} size={40} />
                <View style={{ flex: 1 }}>
                  <Row gap={4}>
                    <T w="semibold" size={16}>
                      {lead.firstName} {lead.lastName}
                    </T>
                    <Icon name="chevron" size={14} color={c.sub} width={2.2} />
                  </Row>
                  <T size={13} tone="sub">
                    {PLAY[d.play]} · Tap for notes
                  </T>
                </View>
              </Pressable>
              <T w="bold" size={12} tone="sub">
                {d.channel === 'email' ? 'Email' : 'Text'} · {SOURCE_NAME[lead.crm]}
              </T>
            </Row>
            {versions.length > 1 && !editing ? (
              <Row gap={8}>
                {versions.map((_, i) => (
                  <Pill key={i} label={`Text ${i + 1}`} size="sm" kind={i === pick ? 'primary' : 'soft'} accessibilityLabel={`Show text option ${i + 1}`} onPress={() => setPicks((p) => ({ ...p, [d.id]: i }))} style={{ flex: 1 }} />
                ))}
              </Row>
            ) : null}
            {editing ? (
              <TextInput value={body} onChangeText={setBody} multiline autoFocus accessibilityLabel="Edit message" style={{ ...font('medium'), fontSize: 15, color: c.text, backgroundColor: c.soft, borderRadius: 6, padding: 14, minHeight: 120, textAlignVertical: 'top' }} />
            ) : (
              <View style={{ alignSelf: 'flex-end', maxWidth: '88%', backgroundColor: c.hero, borderRadius: 6, borderBottomRightRadius: 5, paddingHorizontal: 13, paddingVertical: 9 }}>
                {shown?.subject ? (
                  <T w="semibold" size={15} style={{ color: c.onHero }}>
                    {shown.subject}
                  </T>
                ) : null}
                <T size={16} style={{ color: c.onHero }}>
                  {shown?.body ?? d.body}
                </T>
              </View>
            )}
            {d.home ? <Home h={d.home} /> : null}
            {held[d.id] ? (
              <T w="semibold" size={14} tone="accent">
                {held[d.id]}
              </T>
            ) : null}
            <HomeSwap key={d.id} draft={d} onChanged={() => setHeld((h) => { const n = { ...h }; delete n[d.id]; return n; })} />
            <T size={13} tone="sub">
              <T w="semibold" size={13} tone="sub">
                Why:{' '}
              </T>
              {shown?.why ?? d.why}
            </T>
            <Row>
              <Pill label="Skip" kind="soft" onPress={() => { setEditing(false); decideDraft(d.id, 'skipped'); }} style={{ flex: 1 }} />
              <Pill label={editing ? 'Done' : 'Edit'} kind="soft" onPress={() => { if (!editing) setBody(shown?.body ?? d.body); setEditing((v) => !v); }} style={{ flex: 1 }} />
              <Pill label={sending ? 'Checking…' : viaCrm(lead.crm) ? 'Send' : 'Text from phone'} icon="send" disabled={sending} onPress={() => void sendOne(d.id, editing ? body : pick > 0 ? shown?.body : undefined)} style={{ flex: 2 }} />
            </Row>
          </Card>
          {!viaCrm(lead.crm) && lead.crm !== 'manual' && CRM_CAN_SEND[lead.crm as keyof typeof CRM_CAN_SEND] ? (
            <T size={13} tone="sub" style={{ textAlign: 'center' }}>
              Opens your phone with the text ready.{' '}
              <T size={13} tone="accent" onPress={() => router.push('/my-number')}>
                {`Send from your ${SOURCE_NAME[lead.crm]} number instead`}
              </T>
            </T>
          ) : null}
          {pending.length > 1 ? (
            <>
              {viaCrm(lead.crm) ? <Pill label={confirmAll ? `Tap again to send all ${pending.length}` : `Send all ${pending.length}`} kind={confirmAll ? 'primary' : 'soft'} onPress={sendAll} /> : null}
              {confirmAll ? (
                <T size={13} tone="sub" style={{ textAlign: 'center', marginTop: -6 }}>
                  Sends every message below as written.{' '}
                  <T size={13} tone="accent" onPress={() => setConfirmAll(false)}>
                    Cancel
                  </T>
                </T>
              ) : null}
              <SectionLabel>Up next</SectionLabel>
              <List>
                {pending.slice(1).map((x) => {
                  const l = get(x.leadId);
                  return l ? <ListRow key={x.id} onPress={() => router.push(`/lead/${l.id}`)} label={`${l.firstName} ${l.lastName}`} sub={x.body.slice(0, 70) + (x.body.length > 70 ? '…' : '')} value={x.home ? (x.home.kind === 'community' ? 'Community' : 'Home') : x.channel === 'email' ? 'Email' : 'Text'} /> : null;
                })}
              </List>
            </>
          ) : null}
        </>
      )}
    </Screen>
  );
}
