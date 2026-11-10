// Today — the hot sheet. One ranked list (brand-new leads on top, ~10 max),
// filters for the kind of follow-up, and what's ready for you.
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView } from 'react-native';

import type { LeadLabel } from '@back40/core';

import { LeadRow } from '@/components/LeadRow';
import { Chip, IconButton, List, ListRow, Screen, SectionLabel, T } from '@/components/ui';
import { useStore } from '@/data/store';

type Filter = 'all' | 'hot' | 'promised' | 'cold' | 'back';
const FILTERS: { key: Filter; label: string; labels: LeadLabel[] }[] = [
  { key: 'all', label: 'All', labels: [] },
  { key: 'hot', label: 'Hot', labels: ['brand_new', 'hot_now'] },
  { key: 'promised', label: 'Promised', labels: ['promised', 'follow_up'] },
  { key: 'back', label: 'Back looking', labels: ['back_again'] },
  { key: 'cold', label: 'Going cold', labels: ['slipping'] },
];

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export default function Today() {
  const { today, streak, drafts, settings, notice, clearNotice, isLiveMode, status, profile } = useStore();
  const needsCrm = isLiveMode && status === 'ready' && !profile?.crm;
  const [filter, setFilter] = useState<Filter>('all');
  const pending = drafts.filter((d) => d.status === 'pending').length;
  const date = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.key, f.key === 'all' ? today.length : today.filter((r) => f.labels.includes(r.label)).length])) as Record<Filter, number>, [today]);
  const shown = filter === 'all' ? today : today.filter((r) => FILTERS.find((f) => f.key === filter)!.labels.includes(r.label));
  const newest = today.find((r) => r.label === 'brand_new');

  return (
    <Screen title="Today" kicker={`${date}${streak ? ` · ${streak}-day streak` : ''}`} right={<IconButton icon="chat" label="Ask Back 40" onPress={() => router.push('/ask')} />}>
      <T size={15} tone="body" style={{ paddingHorizontal: 4, marginTop: -4 }}>
        <T w="semibold" size={15} tone="accent">
          {today.length} to call.
        </T>{' '}
        {newest ? `${newest.lead.firstName} just came in.` : `${greeting()}, ${settings.name}.`}
      </T>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -16 }} contentContainerStyle={{ gap: 6, paddingHorizontal: 16, paddingVertical: 4 }}>
        {FILTERS.filter((f) => f.key === 'all' || counts[f.key] > 0).map((f) => (
          <Chip key={f.key} label={f.label} count={counts[f.key]} on={filter === f.key} onPress={() => setFilter(f.key)} />
        ))}
      </ScrollView>

      {notice ? (
        <List>
          <ListRow label={notice} sub="Tap to dismiss" onPress={clearNotice} />
        </List>
      ) : null}

      {needsCrm ? (
        <List>
          <ListRow label="Connect your CRM" sub="Bring in your leads from Lofty or Follow Up Boss. Takes a minute." onPress={() => router.push('/connect')} />
        </List>
      ) : shown.length ? (
        <List inset={36}>
          {shown.map((item) => (
            <LeadRow key={item.lead.id} item={item} />
          ))}
        </List>
      ) : (
        <List>
          <ListRow label={isLiveMode ? 'Nobody needs a call right now' : 'Nothing here'} sub={isLiveMode ? 'New leads and hot activity from your CRM show up here within a minute.' : undefined} />
        </List>
      )}
      {status === 'demo' && isLiveMode === false ? (
        <T size={12} tone="sub" style={{ textAlign: 'center' }}>
          Sample leads. Sign in to see yours.
        </T>
      ) : null}

      <SectionLabel>Ready for you</SectionLabel>
      <List>
        {pending > 0 ? <ListRow label="Messages to approve" sub="Keeping in touch with your other leads" value={String(pending)} onPress={() => router.push('/approve')} /> : null}
        <ListRow label="Morning briefing" value="2 min" onPress={() => router.push('/briefing')} />
      </List>
      <T size={12} tone="sub" style={{ textAlign: 'center', marginTop: 4 }}>
        Hold a lead to pin it. Everyone else is in Hot & warm.
      </T>
    </Screen>
  );
}
