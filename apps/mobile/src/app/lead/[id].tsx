// Page 2 — Lead detail (card stack style, Nov 11). Everything needed before dialing, so the agent never
// opens the CRM first. Decisions (Nov 7): AI summary collapsed to 2 lines;
// history shows 20 + "Load more"; stage / follow-up / tags / notes editable
// and written back to the CRM; phone, email, source stay CRM-only.
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, Linking, Pressable, ScrollView, TextInput, View } from 'react-native';

import { BADGE_TEXT, labelFor } from '@back40/core';

import { Icon, type IconName } from '@/components/Icon';
import { Card, Chip, List, ListRow, Row, Screen, SectionLabel, T } from '@/components/ui';
import { STATUS_TEXT } from '@/lib/status';
import { money, relTime, useStore } from '@/data/store';
import { callLead, textLead } from '@/lib/actions';
import { SOURCE_NAME } from '@/lib/crm';
import { useTheme } from '@/theme/ThemeProvider';
import { font } from '@/theme/tokens';

export default function LeadDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c } = useTheme();
  const { lead: get, stages, settings, updateLead, addNote, togglePin, loadTimeline, dealsFor } = useStore();
  const lead = get(id);
  const [moreSummary, setMoreSummary] = useState(false);
  const [shown, setShown] = useState(20);
  const [editingStage, setEditingStage] = useState(false);
  const [note, setNote] = useState('');
  useEffect(() => {
    void loadTimeline(id);
  }, [id, loadTimeline]);
  if (!lead) return null;

  const now = Date.now();
  const label = labelFor(lead, settings.rules, now);

  const big = (icon: IconName, text: string, onPress: () => void, primary?: boolean) => (
    <Pressable accessibilityRole="button" accessibilityLabel={`${text} ${lead.firstName}`} onPress={onPress} style={({ pressed }) => ({ flex: 1, height: 64, borderRadius: 2, backgroundColor: primary ? c.accent : c.text, alignItems: 'center', justifyContent: 'center', gap: 4, opacity: pressed ? 0.8 : 1 })}>
      <Icon name={icon} size={20} color={primary ? '#FFFFFF' : c.bg} />
      <T w="bold" size={14} style={{ color: primary ? '#FFFFFF' : c.bg }}>
        {text}
      </T>
    </Pressable>
  );
  const f = lead.fields;
  const chips = [...(f.areas ?? []), f.budgetMax ? `${f.budgetMin ? `${money(f.budgetMin)}–` : 'Up to '}${money(f.budgetMax)}` : null, f.bedsMin ? `${f.bedsMin}+ beds` : null, f.timeline ?? null, f.preApproved ? 'Pre-approved' : null].filter(Boolean) as string[];
  const deals = dealsFor(lead.id);
  const contacted = lead.lastContactAt ? `Last contact ${relTime(lead.lastContactAt)}` : 'Never contacted';

  return (
    <Screen bottomSpace={40}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 2, backgroundColor: c.card, borderWidth: 1, borderColor: c.sep, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.7 : 1 })}>
          <Icon name="back" size={20} color={c.text} width={2.4} />
        </Pressable>
        <T w="semibold" size={13} tone="sub">
          {lead.crm === 'manual' ? 'Added in Back 40' : `Synced with ${SOURCE_NAME[lead.crm]}`}
        </T>
        <Pressable accessibilityRole="button" accessibilityLabel={lead.pinned ? 'Unpin from Today' : 'Pin to Today'} onPress={() => togglePin(lead.id)} style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 2, backgroundColor: lead.pinned ? c.text : c.card, borderWidth: 1, borderColor: lead.pinned ? c.text : c.sep, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.7 : 1 })}>
          <Icon name="pin" size={19} color={lead.pinned ? c.bg : c.text} />
        </Pressable>
      </Row>

      <View style={{ gap: 8, paddingHorizontal: 4, marginTop: 6 }}>
        <View style={{ alignSelf: 'flex-start', backgroundColor: c.accent, borderRadius: 2, paddingHorizontal: 11, paddingVertical: 6 }}>
          <T w="bold" size={12} style={{ color: '#FFFFFF', letterSpacing: 0.6 }}>
            {STATUS_TEXT[label].toLowerCase() === lead.stage.toLowerCase() || STATUS_TEXT[label] === 'Working' ? lead.stage.toUpperCase() : `${STATUS_TEXT[label].toUpperCase()} · ${lead.stage.toUpperCase()}`}
          </T>
        </View>
        <T w="heavy" size={38} style={{ lineHeight: 41 }}>
          {lead.firstName} {lead.lastName}
        </T>
        <T size={16} tone="sub">
          {contacted}
          {lead.source ? ` · ${lead.source}` : ''}
        </T>
      </View>

      <Row gap={10} style={{ marginTop: 4 }}>
        {big('phone', 'Call', () => callLead(lead), true)}
        {big('text', 'Text', () => textLead(lead))}
        {big('mail', 'Email', () => router.push(`/compose/${lead.id}?channel=email`))}
      </Row>

      <Card style={{ gap: 6 }}>
        <T w="bold" size={12} tone="accent" style={{ letterSpacing: 0.8 }}>
          WHY NOW
        </T>
        <T w="semibold" size={17} style={{ lineHeight: 23 }}>
          {lead.aiWhyNow ?? (lead.crm === 'manual' ? (lead.lastContactAt ? `You last reached out ${relTime(lead.lastContactAt)}.` : 'You added this lead. Make the first call.') : 'Recent activity in your CRM.')}
        </T>
        {lead.aiOpener ? (
          <T size={15} tone="body">
            Open with “{lead.aiOpener}”
          </T>
        ) : null}
      </Card>

      {chips.length ? (
        <>
          <SectionLabel>What they want</SectionLabel>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {chips.map((x) => (
              <View key={x} style={{ backgroundColor: c.card, borderWidth: 1, borderColor: c.sep, borderRadius: 2, paddingHorizontal: 13, paddingVertical: 8 }}>
                <T w="semibold" size={14}>
                  {x}
                </T>
              </View>
            ))}
          </View>
        </>
      ) : null}

      {deals.length ? (
        <>
          <SectionLabel>Deals for {lead.firstName || 'them'}</SectionLabel>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -16 }} contentContainerStyle={{ gap: 12, paddingHorizontal: 16 }}>
            {deals.map((h) => (
              <Pressable key={h.id} accessibilityRole="link" accessibilityLabel={`Open ${h.title}`} disabled={!h.url} onPress={() => h.url && void Linking.openURL(h.url)} style={({ pressed }) => ({ width: 232, borderRadius: 2, overflow: 'hidden', backgroundColor: c.card, borderWidth: 1, borderColor: c.sep, opacity: pressed ? 0.85 : 1 })}>
                <View style={{ height: 124, backgroundColor: c.track }}>
                  {h.photo ? <Image source={{ uri: h.photo }} style={{ width: '100%', height: '100%' }} accessibilityIgnoresInvertColors /> : null}
                  {h.badge ? (
                    <View style={{ position: 'absolute', left: 10, top: 10, backgroundColor: h.badge === 'price_drop' ? c.accent : c.text, borderRadius: 2, paddingHorizontal: 9, paddingVertical: 5 }}>
                      <T w="bold" size={11} style={{ color: h.badge === 'price_drop' ? '#FFFFFF' : c.bg, letterSpacing: 0.5 }}>
                        {BADGE_TEXT[h.badge].toUpperCase()}
                      </T>
                    </View>
                  ) : null}
                </View>
                <View style={{ padding: 12, gap: 2 }}>
                  <T w="heavy" size={18}>
                    {h.price ? money(h.price, false) : 'Price on request'}
                  </T>
                  <T w="semibold" size={14} numberOfLines={1}>
                    {h.title}
                  </T>
                  <T size={13} tone="sub" numberOfLines={1}>
                    {[h.city, h.beds ? `${h.beds} bd` : null, h.baths ? `${h.baths} ba` : null, h.sqft ? `${h.sqft.toLocaleString('en-US')} sqft` : null].filter(Boolean).join(' · ')}
                  </T>
                </View>
              </Pressable>
            ))}
          </ScrollView>
        </>
      ) : null}

      {lead.aiSummary ? (
        <>
          <SectionLabel>Summary</SectionLabel>
          <Card style={{ gap: 4 }}>
            <T size={15} tone="body" numberOfLines={moreSummary ? undefined : 2}>
              {lead.aiSummary}
            </T>
            <Pressable accessibilityRole="button" onPress={() => setMoreSummary((v) => !v)} hitSlop={8}>
              <T w="medium" size={14} tone="accent">
                {moreSummary ? 'Less' : 'More'}
              </T>
            </Pressable>
          </Card>
        </>
      ) : null}

      <SectionLabel>Details</SectionLabel>
      <List>
        <ListRow label="Phone" value={lead.phone ? prettyPhone(lead.phone) : '—'} />
        <ListRow label="Came from" value={lead.source ?? '—'} />
        <ListRow label="Next follow-up" value={lead.nextFollowUpAt ? new Date(lead.nextFollowUpAt).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : 'Not set'} />
        <ListRow
          label="Potential commission"
          value={lead.fields.potentialCommission ? money(lead.fields.potentialCommission, false) : 'Add'}
          valueTone={lead.fields.potentialCommission ? c.good : c.accentText}
          sub={lead.fields.purchasePrice && lead.fields.commissionRate ? `${lead.fields.commissionRate}% of ${money(lead.fields.purchasePrice)}` : undefined}
          onPress={() => router.push(`/commission/${lead.id}`)}
        />
        <ListRow label="Stage" value={lead.stage} onPress={() => setEditingStage((v) => !v)} />
        {editingStage ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, padding: 12 }}>
            {stages.map((s) => (
              <Chip key={s} label={s} on={lead.stage === s} onPress={() => { updateLead(lead.id, { stage: s }); setEditingStage(false); }} />
            ))}
          </View>
        ) : null}
      </List>

      <Row gap={8}>
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="Add a note…"
          placeholderTextColor={c.sub}
          multiline
          accessibilityLabel="Note"
          style={{ flex: 1, minHeight: 44, maxHeight: 120, ...font('medium'), fontSize: 15, color: c.text, backgroundColor: c.card, borderRadius: 2, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10, textAlignVertical: 'top' }}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Save note to CRM"
          disabled={!note.trim()}
          onPress={() => { addNote(lead.id, note.trim()); setNote(''); }}
          style={{ width: 44, height: 44, borderRadius: 2, backgroundColor: note.trim() ? c.text : c.soft, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="send" size={18} color={note.trim() ? c.bg : c.sub} />
        </Pressable>
      </Row>

      <SectionLabel>History</SectionLabel>
      <List>
        {lead.timeline.slice(0, shown).map((h) => (
          <View key={h.id} style={{ paddingHorizontal: 16, paddingVertical: 10, gap: 2 }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <T w="medium" size={15} style={{ flex: 1 }}>
                {h.title}
              </T>
              <T size={12} tone="sub">
                {relTime(h.at)}
              </T>
            </Row>
            {h.body ? (
              <T size={14} tone="body">
                {h.body}
              </T>
            ) : null}
            <T size={12} tone="sub">
              {h.source === 'back40' ? 'Back 40' : SOURCE_NAME[lead.crm]}
            </T>
          </View>
        ))}
        {lead.timeline.length > shown ? <ListRow label="Load more" onPress={() => setShown((n) => n + 20)} /> : null}
      </List>
    </Screen>
  );
}

/** 9095550142 → (909) 555-0142; anything else stays as the CRM sent it. */
function prettyPhone(p: string) {
  const d = p.replace(/[^0-9]/g, '').replace(/^1(?=\d{10}$)/, '');
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : p;
}
