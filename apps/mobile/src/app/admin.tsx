// Team admin — team leaders only. Opened from Me (and works on a laptop at
// /admin). Shows where the team's leads live (how many each agent has in each
// pipeline stage) and which hot leads are going stale, with one-tap reassign.
//
// Live data: the `team_pipeline` view (supabase/migrations/…_pipeline.sql) does
// the counting in Postgres, so this stays fast with thousands of leads.
import { Redirect, router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { bucketFor, groupByBucket, PIPELINE, type BucketId } from '@back40/core';

import { Avatar, Card, Chip, IconButton, List, Row, Screen, T, NavBar, Dot, ListRow, SectionLabel } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { SAMPLE_TEAM_PIPELINE } from '@/data/sample';
import { money, useStore } from '@/data/store';
import * as live from '@/data/supabase';
import { useTheme } from '@/theme/ThemeProvider';

const SHORT: Record<BucketId, string> = { new: 'New', contacted: 'Contacted', lender: 'Lender', preapproved: 'Pre-appr.', looking: 'Looking', offers: 'Offers', escrow: 'Escrow' };

export default function Admin() {
  const { c } = useTheme();
  const { team, settings, leads, isLiveMode, profile } = useStore();
  const [moving, setMoving] = useState<string | null>(null);
  const [moved, setMoved] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const mine = useMemo(() => groupByBucket(leads), [leads]);
  const [liveTeam, setLiveTeam] = useState<live.TeamRow[] | null>(null);
  const [liveStale, setLiveStale] = useState<{ leadId: string; name: string; days: number; bucket: BucketId; agentId: string | null }[]>([]);

  useEffect(() => {
    if (!isLiveMode || !profile) return;
    void live.fetchTeam(profile.orgId).then(setLiveTeam).catch(() => setLiveTeam([]));
    void live.fetchStale(profile.orgId).then((rows) =>
      setLiveStale(
        rows.map((r) => ({
          leadId: r.id as string,
          name: `${r.first_name} ${r.last_name}`.trim(),
          days: r.last_contact_at ? Math.max(2, Math.round((Date.now() - Date.parse(r.last_contact_at as string)) / 86_400_000)) : 0,
          bucket: bucketFor({ stage: r.stage as string }) ?? 'new',
          agentId: r.assigned_user_id as string | null,
        })),
      ),
    );
  }, [isLiveMode, profile]);

  if (!(settings.role === 'owner' || settings.role === 'admin')) return <Redirect href="/" />;

  // Live: real counts per teammate. Demo: sample numbers; "You" uses your board.
  const rows = isLiveMode
    ? (liveTeam ?? []).map((m) => ({
        a: { id: m.id, name: m.name, initials: m.initials, role: m.role, scoreThisWeek: 0, streakDays: 0, staleHotLeads: m.stale } as (typeof team)[number],
        buckets: Object.fromEntries(PIPELINE.map((b) => [b.id, m.buckets[b.stage] ?? 0])) as Record<BucketId, number>,
        commission: m.commission,
        stale: liveStale.filter((x) => x.agentId === m.id).map((x) => ({ name: x.name, days: x.days, bucket: x.bucket, leadId: x.leadId })),
      }))
    : team.map((a) => {
    const p = SAMPLE_TEAM_PIPELINE[a.id] ?? { buckets: { new: 0, contacted: 0, lender: 0, preapproved: 0, looking: 0, offers: 0, escrow: 0 }, commission: 0, stale: [] };
    const buckets = a.id === 'me' ? (Object.fromEntries(PIPELINE.map((b) => [b.id, mine[b.id].length])) as Record<BucketId, number>) : p.buckets;
    return { a, buckets, commission: p.commission, stale: p.stale as { name: string; days: number; bucket: BucketId; leadId?: string }[] };
  });
  const totals = Object.fromEntries(PIPELINE.map((b) => [b.id, rows.reduce((t, r) => t + r.buckets[b.id], 0)])) as Record<BucketId, number>;
  const maxTotal = Math.max(1, ...Object.values(totals));
  const stale = rows.flatMap((r) => r.stale.map((s) => ({ ...s, agent: r.a }))).filter((s) => !moved[s.name]);
  const teamMoney = rows.reduce((t, r) => t + r.commission, 0);

  return (
    <Screen bottomSpace={40}>
      <NavBar back onClose={() => router.back()} />
      <View style={{ paddingHorizontal: 4 }}>
        <T w="bold" size={32}>
          Team admin
        </T>
        <T size={14} tone="sub">
          Where your team's leads are, and who needs a nudge.
        </T>
      </View>

      {/* Going stale */}
      <SectionLabel>{stale.length ? `Going stale · ${stale.length}` : 'Going stale'}</SectionLabel>
      <List inset={36}>
        {stale.length === 0 ? <ListRow label="No hot leads going stale" /> : null}
        {stale.map((s) => (
          <View key={s.name}>
            <Row gap={12} style={{ paddingLeft: 16, paddingRight: 14, paddingVertical: 11 }}>
              <Dot color={c.accent} />
              <View style={{ flex: 1 }}>
                <T w="semibold" size={16}>
                  {s.name}
                </T>
                <T size={13} tone="sub">
                  {s.agent.name} · {SHORT[s.bucket]} · {s.days} days, no contact
                </T>
              </View>
              <Pressable accessibilityRole="button" onPress={() => setMoving(moving === s.name ? null : s.name)} hitSlop={8}>
                <T w="medium" size={15} tone="accent">
                  Reassign
                </T>
              </Pressable>
            </Row>
            {moving === s.name ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingLeft: 36, paddingRight: 14, paddingBottom: 12 }}>
                {team
                  .filter((a) => a.id !== s.agent.id)
                  .map((a) => (
                    <Chip key={a.id} label={a.name} on={false} onPress={() => { setMoved((m) => ({ ...m, [s.name]: a.name })); setMoving(null); if (isLiveMode && s.leadId) void live.leadAction(s.leadId, 'assign', { userId: a.id }).catch(() => undefined); }} />
                  ))}
              </View>
            ) : null}
          </View>
        ))}
      </List>
      {Object.entries(moved).map(([lead, to]) => (
        <T key={lead} size={13} tone="good" style={{ paddingHorizontal: 16 }}>
          {lead} → {to}. Reassigned in your CRM.
        </T>
      ))}

      {/* Team pipeline */}
      <SectionLabel right={<T w="medium" size={13} tone="good">{money(teamMoney)} potential</T>}>Team pipeline</SectionLabel>
      <Card style={{ gap: 10 }}>
        {PIPELINE.map((b) => (
          <Row key={b.id} gap={10}>
            <T size={13} w="semibold" style={{ width: 80 }}>
              {SHORT[b.id]}
            </T>
            <View style={{ flex: 1, height: 10, borderRadius: 5, backgroundColor: c.soft, overflow: 'hidden' }}>
              <View style={{ width: `${(totals[b.id] / maxTotal) * 100}%`, height: 10, borderRadius: 5, backgroundColor: b.id === 'escrow' ? c.good : c.accent }} />
            </View>
            <T w="heavy" size={13} style={{ width: 28, textAlign: 'right' }}>
              {totals[b.id]}
            </T>
          </Row>
        ))}
      </Card>

      {/* By agent: one row each; tap to see their stages */}
      <SectionLabel>By agent</SectionLabel>
      <List>
        {rows.map(({ a, buckets, commission, stale: st }) => {
          const total = PIPELINE.reduce((t, b) => t + buckets[b.id], 0);
          const open = expanded === a.id;
          return (
            <View key={a.id}>
              <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setExpanded(open ? null : a.id)} style={({ pressed }) => ({ minHeight: 56, paddingHorizontal: 16, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: pressed ? c.soft : 'transparent' })}>
                <Avatar initials={a.initials} size={34} bg={c.soft} fg={c.text} />
                <View style={{ flex: 1 }}>
                  <T w="semibold" size={15}>
                    {a.name}
                  </T>
                  <T size={12} tone="sub">
                    {total} leads · {money(commission)}
                  </T>
                </View>
                {st.length ? (
                  <T w="bold" size={12} tone="accent">
                    {st.length} stale
                  </T>
                ) : null}
                <View style={{ transform: [{ rotate: open ? '90deg' : '0deg' }] }}>
                  <Icon name="chevron" size={16} color={c.sub} />
                </View>
              </Pressable>
              {open ? (
                <View style={{ paddingHorizontal: 16, paddingBottom: 12, gap: 6 }}>
                  {PIPELINE.map((b) => (
                    <Row key={b.id} style={{ justifyContent: 'space-between' }}>
                      <T size={14} tone="body">
                        {b.label}
                      </T>
                      <T w="semibold" size={14} style={{ color: buckets[b.id] ? c.text : c.sub }}>
                        {buckets[b.id]}
                      </T>
                    </Row>
                  ))}
                </View>
              ) : null}
            </View>
          );
        })}
      </List>
    </Screen>
  );
}
