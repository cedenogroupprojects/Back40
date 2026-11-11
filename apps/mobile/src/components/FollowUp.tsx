// Follow up — every message Back 40 wrote for the agent's leads, one at a time.
// Each is written for that person (their notes, history and the deal homes that
// fit them), never a template. Send, edit, pick a different home, or skip.
// Lives in its own tab and as the /approve sheet.
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Image, Linking, Pressable, TextInput, View } from 'react-native';

import { BADGE_TEXT, type HomeCard } from '@back40/core';

import { Icon } from '@/components/Icon';
import { Avatar, Card, IconButton, Pill, Row, Screen, T, NavBar, List, ListRow, SectionLabel } from '@/components/ui';
import { initials, money, useStore } from '@/data/store';
import * as live from '@/data/supabase';
import { SOURCE_NAME } from '@/lib/crm';
import { useTheme } from '@/theme/ThemeProvider';
import { font } from '@/theme/tokens';

const PLAY: Record<string, string> = { speed_to_lead: 'Brand new lead', no_answer: 'Didn’t answer', back40_sweep: 'Back on the market', recap: 'Follow-up', ask: 'You asked', nurture: 'Keeping in touch' };

/** The home or community a nurture message features. Tap to open the listing. */
function Home({ h }: { h: HomeCard }) {
  const { c } = useTheme();
  const price = h.price ? money(h.price, false) : h.priceFrom ? `From ${money(h.priceFrom, false)}` : null;
  const facts = [price, h.beds ? `${h.beds} bd` : null, h.baths ? `${h.baths} ba` : null].filter(Boolean).join(' · ');
  const body = (
    <Row gap={12} style={{ backgroundColor: c.soft, borderRadius: 14, padding: 10 }}>
      {h.photo ? (
        <Image source={{ uri: h.photo }} style={{ width: 64, height: 64, borderRadius: 10, backgroundColor: c.track }} accessibilityIgnoresInvertColors />
      ) : (
        <View style={{ width: 64, height: 64, borderRadius: 10, backgroundColor: c.card, alignItems: 'center', justifyContent: 'center' }}>
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

/** Pick one of up to 5 homes; the message rewrites itself around it. */
function HomePicker({ options, current, onPick }: { options: HomeCard[]; current?: string; onPick: (id: string) => Promise<void> }) {
  const { c } = useTheme();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  if (options.length < 2) return null;
  const pick = async (id: string) => {
    if (id === current || busy) return;
    setBusy(id);
    setErr(null);
    try {
      await onPick(id);
      setOpen(false);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <View style={{ gap: 8 }}>
      <Pressable accessibilityRole="button" onPress={() => setOpen((v) => !v)} style={{ alignSelf: 'flex-start', paddingVertical: 4 }}>
        <T w="semibold" size={14} tone="accent">
          {open ? 'Keep this home' : `Pick a different home (${options.length})`}
        </T>
      </Pressable>
      {open ? (
        <View style={{ gap: 8 }}>
          {options.map((h) => {
            const on = h.id === current;
            const facts = [h.price ? money(h.price, false) : null, h.beds ? `${h.beds} bd` : null, h.baths ? `${h.baths} ba` : null, h.sqft ? `${h.sqft.toLocaleString('en-US')} sqft` : null].filter(Boolean).join(' · ');
            return (
              <Pressable key={h.id} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={`Use ${h.title}`} onPress={() => void pick(h.id)}>
                <Row gap={12} style={{ borderRadius: 14, padding: 10, backgroundColor: on ? c.soft : c.card, borderWidth: 1.5, borderColor: on ? c.text : c.sep }}>
                  {h.photo ? (
                    <Image source={{ uri: h.photo }} style={{ width: 72, height: 72, borderRadius: 10, backgroundColor: c.track }} accessibilityIgnoresInvertColors />
                  ) : (
                    <View style={{ width: 72, height: 72, borderRadius: 10, backgroundColor: c.soft }} />
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
          })}
          {err ? (
            <T size={13} tone="accent">
              {err}
            </T>
          ) : (
            <T size={12} tone="sub">
              Tap a home and the message rewrites itself around it.
            </T>
          )}
        </View>
      ) : null}
    </View>
  );
}

export function FollowUpQueue({ inTab = false }: { inTab?: boolean }) {
  const { c } = useTheme();
  const { drafts, lead: get, decideDraft, swapHome } = useStore();
  const pending = drafts.filter((d) => d.status === 'pending');
  const total = drafts.length;
  const d = pending[0];
  const lead = d ? get(d.leadId) : undefined;
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState('');
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
  const sendAll = () => {
    if (!confirmAll) return setConfirmAll(true);
    for (const x of pending) decideDraft(x.id, 'sent');
    setConfirmAll(false);
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
              <Avatar initials={initials(lead)} size={40} />
              <View style={{ flex: 1 }}>
                <T w="semibold" size={16}>
                  {lead.firstName} {lead.lastName}
                </T>
                <T size={13} tone="sub">
                  {PLAY[d.play]}
                </T>
              </View>
              <T w="bold" size={12} tone="sub">
                {d.channel === 'email' ? 'Email' : 'Text'} · {SOURCE_NAME[lead.crm]}
              </T>
            </Row>
            {editing ? (
              <TextInput value={body} onChangeText={setBody} multiline autoFocus accessibilityLabel="Edit message" style={{ ...font('medium'), fontSize: 15, color: c.text, backgroundColor: c.soft, borderRadius: 16, padding: 14, minHeight: 120, textAlignVertical: 'top' }} />
            ) : (
              <View style={{ alignSelf: 'flex-end', maxWidth: '88%', backgroundColor: c.text, borderRadius: 18, borderBottomRightRadius: 5, paddingHorizontal: 13, paddingVertical: 9 }}>
                {d.subject ? (
                  <T w="semibold" size={15} style={{ color: c.bg }}>
                    {d.subject}
                  </T>
                ) : null}
                <T size={16} style={{ color: c.bg }}>
                  {d.body}
                </T>
              </View>
            )}
            {d.home ? <Home h={d.home} /> : null}
            {d.homeOptions?.length ? <HomePicker key={d.id} options={d.homeOptions} current={d.home?.id} onPick={(id) => swapHome(d.id, id)} /> : null}
            <T size={13} tone="sub">
              <T w="semibold" size={13} tone="sub">
                Why:{' '}
              </T>
              {d.why}
            </T>
            <Row>
              <Pill label="Skip" kind="soft" onPress={() => { setEditing(false); decideDraft(d.id, 'skipped'); }} style={{ flex: 1 }} />
              <Pill label={editing ? 'Done' : 'Edit'} kind="soft" onPress={() => { if (!editing) setBody(d.body); setEditing((v) => !v); }} style={{ flex: 1 }} />
              <Pill label="Send" icon="send" onPress={() => { decideDraft(d.id, 'sent', editing ? body : undefined); setEditing(false); }} style={{ flex: 2 }} />
            </Row>
          </Card>
          {pending.length > 1 ? (
            <>
              <Pill label={confirmAll ? `Tap again to send all ${pending.length}` : `Send all ${pending.length}`} kind={confirmAll ? 'primary' : 'soft'} onPress={sendAll} />
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
                  return l ? <ListRow key={x.id} label={`${l.firstName} ${l.lastName}`} sub={x.body.slice(0, 70) + (x.body.length > 70 ? '…' : '')} value={x.home ? (x.home.kind === 'community' ? 'Community' : 'Home') : x.channel === 'email' ? 'Email' : 'Text'} /> : null;
                })}
              </List>
            </>
          ) : null}
        </>
      )}
    </Screen>
  );
}
