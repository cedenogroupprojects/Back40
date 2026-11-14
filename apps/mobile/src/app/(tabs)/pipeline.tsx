// Pipeline — the agent's buyers by the step they're on:
// New → Contacted → Sent to lender → Pre-approved → Actively looking → Submitting offers → In escrow.
//
// Built for one thumb, no dragging:
// - Stage chips across the top (with counts) pick which step you're looking at.
// - Each row has a small "<next step> →" button for the common case.
// - "···" (or holding the row) opens a sheet with every step.
// - Every move shows an Undo, and writes the stage back to the CRM.
import { router } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { groupByBucket, type Bucket, type BucketId, type Lead } from '@back40/core';

import { Icon } from '@/components/Icon';
import { Card, Chip, IconButton, List, ListRow, Row, Screen, T } from '@/components/ui';
import { money, relTime, useStore } from '@/data/store';
import { tap } from '@/lib/actions';
import { SOURCE_NAME } from '@/lib/crm';
import { useTheme } from '@/theme/ThemeProvider';
import { font } from '@/theme/tokens';

export default function Pipeline() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const { leads, updateLead, pipeline: PIPELINE } = useStore();
  const groups = useMemo(() => groupByBucket(leads, PIPELINE), [leads, PIPELINE]);
  const [picked, setStage] = useState<BucketId | null>(null);
  // Start on the first column that has someone in it.
  const stage = picked && PIPELINE.some((b) => b.id === picked) ? picked : (PIPELINE.find((b) => groups[b.id]?.length)?.id ?? PIPELINE[0]!.id);
  const [sheet, setSheet] = useState<Lead | null>(null);
  // Search finds anyone in the CRM by name or phone (it used to live on the Leads tab).
  const [q, setQ] = useState('');
  const term = q.trim().toLowerCase();
  const digits = term.replace(/\D/g, '');
  const results = term
    ? leads
        .filter((l) => `${l.firstName} ${l.lastName}`.toLowerCase().includes(term) || (digits.length >= 3 && (l.phone ?? '').replace(/\D/g, '').includes(digits)))
        .slice(0, 40)
    : [];
  const [toast, setToast] = useState<{ text: string; undo: () => void } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const total = PIPELINE.reduce((t, b) => t + (groups[b.id] ?? []).reduce((s, l) => s + (l.fields.potentialCommission ?? 0), 0), 0);
  const list = groups[stage] ?? [];
  const stageMoney = list.reduce((t, l) => t + (l.fields.potentialCommission ?? 0), 0);
  const idx = PIPELINE.findIndex((b) => b.id === stage);
  const next = PIPELINE[idx + 1];

  const move = (lead: Lead, to: Bucket) => {
    setSheet(null);
    if (lead.stage === to.stage) return;
    tap();
    const before = lead.stage;
    updateLead(lead.id, { stage: to.stage });
    if (timer.current) clearTimeout(timer.current);
    setToast({ text: `${lead.firstName} moved to ${to.label}. Saved to ${SOURCE_NAME[lead.crm]}.`, undo: () => updateLead(lead.id, { stage: before }) });
    timer.current = setTimeout(() => setToast(null), 4000);
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Screen
        title="Pipeline"
        kicker={`${PIPELINE.reduce((n, b) => n + (groups[b.id] ?? []).length, 0)} buyers`}
        right={<IconButton icon="plus" label="Add a lead" tone="soft" onPress={() => router.push({ pathname: '/lead/new', params: { stage: PIPELINE[idx]!.stage } })} />}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.card, borderRadius: 4, borderWidth: 1, borderColor: c.sep, paddingHorizontal: 12, minHeight: 44 }}>
          <Icon name="search" size={16} color={c.sub} />
          <TextInput value={q} onChangeText={setQ} placeholder="Search any lead by name or phone" placeholderTextColor={c.sub} accessibilityLabel="Search any lead" autoCorrect={false} style={[font('regular'), { flex: 1, fontSize: 16, color: c.text, minHeight: 44 }]} />
          {q ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => setQ('')} hitSlop={10}>
              <Icon name="close" size={16} color={c.sub} />
            </Pressable>
          ) : null}
        </View>

        {term ? (
          <List>
            {results.length ? (
              results.map((l) => (
                <ListRow key={l.id} label={`${l.firstName} ${l.lastName}`} sub={[l.stage, l.phone].filter(Boolean).join(' · ')} value={l.fields.potentialCommission ? money(l.fields.potentialCommission, false) : undefined} onPress={() => router.push(`/lead/${l.id}`)} />
              ))
            ) : (
              <ListRow label={`No one matches "${q.trim()}"`} sub="Try a first name or the last 4 of their phone" />
            )}
          </List>
        ) : (
        <>
        {/* Potential commission: the number we never want an agent to miss. */}
        <Card style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 12 }}>
          <View style={{ flex: 1 }}>
            <T w="medium" size={13} tone="sub">
              Potential commission
            </T>
            <T w="bold" size={34} tone="good" style={{ marginTop: 2 }}>
              {money(total, false)}
            </T>
          </View>
          <View style={{ alignItems: 'flex-end', paddingBottom: 4 }}>
            <T size={12} tone="sub">
              In {PIPELINE[idx]!.label.toLowerCase()}
            </T>
            <T w="semibold" size={17} tone="good">
              {money(stageMoney, false)}
            </T>
          </View>
        </Card>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -16 }} contentContainerStyle={{ gap: 6, paddingHorizontal: 16, paddingVertical: 4 }}>
          {PIPELINE.map((b) => (
            <Chip key={b.id} label={b.label} count={(groups[b.id] ?? []).length} on={b.id === stage} onPress={() => setStage(b.id)} />
          ))}
        </ScrollView>

        {list.length === 0 ? (
          <List>
            <ListRow label={`Nobody in ${PIPELINE[idx]!.label.toLowerCase()} right now`} sub="Tap to add a lead here" onPress={() => router.push({ pathname: '/lead/new', params: { stage: PIPELINE[idx]!.stage } })} />
          </List>
        ) : (
          <List>
            {list.map((l) => (
              <Pressable
                key={l.id}
                accessibilityRole="button"
                accessibilityHint="Opens the lead. Hold to pick any stage."
                onPress={() => router.push(`/lead/${l.id}`)}
                onLongPress={() => { tap(); setSheet(l); }}
                style={({ pressed }) => ({ paddingLeft: 16, paddingRight: 12, paddingVertical: 11, gap: 6, backgroundColor: pressed ? c.soft : 'transparent' })}>
                <Row gap={10}>
                  <T w="semibold" size={16} numberOfLines={1} style={{ flex: 1 }}>
                    {l.firstName} {l.lastName}
                  </T>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={l.fields.potentialCommission ? `Potential commission ${money(l.fields.potentialCommission, false)}. Edit` : `Add potential commission for ${l.firstName}`}
                    onPress={() => router.push(`/commission/${l.id}`)}
                    hitSlop={8}>
                    <T w={l.fields.potentialCommission ? 'bold' : 'medium'} size={l.fields.potentialCommission ? 17 : 14} style={{ color: l.fields.potentialCommission ? c.good : c.accentText }}>
                      {l.fields.potentialCommission ? money(l.fields.potentialCommission, false) : 'Add $'}
                    </T>
                  </Pressable>
                </Row>
                <Row gap={8}>
                  <T size={13} tone="sub" numberOfLines={1} style={{ flex: 1 }}>
                    {l.lastContactAt ? `Last contact ${relTime(l.lastContactAt)}` : 'Not contacted yet'}
                  </T>
                  {next ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Move ${l.firstName} to ${next.label}`}
                      onPress={() => move(l, next)}
                      hitSlop={6}
                      style={({ pressed }) => ({ minHeight: 28, paddingHorizontal: 10, borderRadius: 4, backgroundColor: c.hotSoft, flexDirection: 'row', alignItems: 'center', gap: 4, opacity: pressed ? 0.6 : 1 })}>
                      <T w="semibold" size={13} tone="accent">
                        {next.label}
                      </T>
                      <Icon name="arrow" size={13} color={c.accentText} />
                    </Pressable>
                  ) : null}
                  <Pressable accessibilityRole="button" accessibilityLabel={`Change stage for ${l.firstName}`} onPress={() => setSheet(l)} hitSlop={8} style={{ width: 26, height: 28, alignItems: 'center', justifyContent: 'center' }}>
                    <T w="bold" size={16} tone="sub">
                      ···
                    </T>
                  </Pressable>
                </Row>
              </Pressable>
            ))}
          </List>
        )}
        <T size={12} tone="sub" style={{ textAlign: 'center', marginTop: 4 }}>
          Tap the next step to move a lead forward, or ··· to pick any stage.
        </T>
        </>
        )}
      </Screen>

      {/* Stage sheet */}
      <Modal visible={sheet != null} transparent animationType="slide" onRequestClose={() => setSheet(null)}>
        <Pressable accessibilityLabel="Close" onPress={() => setSheet(null)} style={{ flex: 1, backgroundColor: c.dim }} />
        {sheet ? (
          <View style={{ backgroundColor: c.bg, borderTopLeftRadius: 4, borderTopRightRadius: 4, paddingHorizontal: 16, paddingTop: 8, paddingBottom: insets.bottom + 16, gap: 10 }}>
            <View style={{ alignSelf: 'center', width: 36, height: 5, borderRadius: 3, backgroundColor: c.sep }} />
            <T w="semibold" size={17} style={{ textAlign: 'center' }}>
              Move {sheet.firstName} to…
            </T>
            <List>
              {PIPELINE.map((b) => {
                const current = b.stage === sheet.stage;
                return (
                  <ListRow
                    key={b.id}
                    label={b.label}
                    value={String((groups[b.id] ?? []).length)}
                    right={current ? <Icon name="check" size={18} color={c.accent} /> : <View style={{ width: 18 }} />}
                    onPress={() => move(sheet, b)}
                  />
                );
              })}
            </List>
          </View>
        ) : null}
      </Modal>

      {toast ? (
        <View style={{ position: 'absolute', left: 12, right: 12, bottom: insets.bottom + 62, backgroundColor: c.text, borderRadius: 4, paddingLeft: 14, paddingRight: 4, minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <T w="medium" size={14} style={{ color: c.bg, flex: 1 }}>
            {toast.text}
          </T>
          <Pressable accessibilityRole="button" onPress={() => { toast.undo(); setToast(null); }} style={{ minHeight: 44, paddingHorizontal: 12, justifyContent: 'center' }}>
            <T w="semibold" size={14} tone="accent">
              Undo
            </T>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
