// Approve drafts — the AI wrote these from CRM notes. Send, edit or skip.
// Nothing goes out without a tap (autopilot is opt-in per play).
import { router } from 'expo-router';
import { useState } from 'react';
import { Image, Linking, Pressable, TextInput, View } from 'react-native';

import type { HomeCard } from '@back40/core';

import { Icon } from '@/components/Icon';
import { Avatar, Card, IconButton, Pill, Row, Screen, T, NavBar, List, ListRow, SectionLabel } from '@/components/ui';
import { initials, money, useStore } from '@/data/store';
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
        <T size={11} w="semibold" tone="sub">
          {h.kind === 'community' ? 'NEW-BUILD COMMUNITY' : 'HOME THAT FITS'}
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

export default function Approve() {
  const { c } = useTheme();
  const { drafts, lead: get, decideDraft } = useStore();
  const pending = drafts.filter((d) => d.status === 'pending');
  const total = drafts.length;
  const d = pending[0];
  const lead = d ? get(d.leadId) : undefined;
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState('');
  const [confirmAll, setConfirmAll] = useState(false);
  const sendAll = () => {
    if (!confirmAll) return setConfirmAll(true);
    for (const x of pending) decideDraft(x.id, 'sent');
    setConfirmAll(false);
  };

  return (
    <Screen bottomSpace={40}>
      <NavBar title={d ? `${total - pending.length + 1} of ${total}` : 'Messages'} onClose={() => router.back()} closeLabel="Done" />
      {!d || !lead ? (
        <View style={{ gap: 12, paddingTop: 40, alignItems: 'center' }}>
          <Icon name="check" size={40} color={c.good} />
          <T w="bold" size={22}>
            All caught up
          </T>
          <T tone="body">New drafts show up here when a lead needs a message.</T>
          <Pill label="Back to Today" kind="ink" onPress={() => router.back()} />
        </View>
      ) : (
        <>
          <T w="bold" size={28} style={{ paddingHorizontal: 4 }}>
            {pending.length} to send
          </T>
          <T size={14} tone="sub" style={{ paddingHorizontal: 4, marginTop: -6 }}>
            Written from what your CRM knows about each person. Send, edit or skip.
          </T>
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
              <View style={{ alignSelf: 'flex-end', maxWidth: '88%', backgroundColor: c.cool, borderRadius: 18, borderBottomRightRadius: 5, paddingHorizontal: 13, paddingVertical: 9 }}>
                {d.subject ? (
                  <T w="semibold" size={15} style={{ color: '#FFFFFF' }}>
                    {d.subject}
                  </T>
                ) : null}
                <T size={16} style={{ color: '#FFFFFF' }}>
                  {d.body}
                </T>
              </View>
            )}
            {d.home ? <Home h={d.home} /> : null}
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
