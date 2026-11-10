// Page 2 — Lead detail. Everything needed before dialing, so the agent never
// opens the CRM first. Decisions (Nov 7): AI summary collapsed to 2 lines;
// history shows 20 + "Load more"; stage / follow-up / tags / notes editable
// and written back to the CRM; phone, email, source stay CRM-only.
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';

import { labelFor } from '@back40/core';

import { Icon, type IconName } from '@/components/Icon';
import { Avatar, Card, Chip, Dot, IconButton, List, ListRow, Row, Screen, SectionLabel, T } from '@/components/ui';
import { STATUS_TEXT, statusColor } from '@/lib/status';
import { initials, money, relTime, useStore } from '@/data/store';
import { callLead, textLead } from '@/lib/actions';
import { SOURCE_NAME } from '@/lib/crm';
import { useTheme } from '@/theme/ThemeProvider';
import { font } from '@/theme/tokens';

export default function LeadDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c } = useTheme();
  const { lead: get, stages, settings, labelText, updateLead, addNote, togglePin, loadTimeline } = useStore();
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

  const color = statusColor(label, c);
  const action = (icon: IconName, text: string, onPress: () => void) => (
    <Pressable accessibilityRole="button" accessibilityLabel={`${text} ${lead.firstName}`} onPress={onPress} style={({ pressed }) => ({ flex: 1, minHeight: 58, borderRadius: 12, backgroundColor: c.card, alignItems: 'center', justifyContent: 'center', gap: 4, opacity: pressed ? 0.6 : 1 })}>
      <Icon name={icon} size={20} color={c.accent} />
      <T w="medium" size={12} tone="accent">
        {text}
      </T>
    </Pressable>
  );

  return (
    <Screen bottomSpace={40}>
      <Row style={{ justifyContent: 'space-between', marginHorizontal: -6 }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: 36 }}>
          <Icon name="back" size={22} color={c.accent} width={2.2} />
          <T size={17} style={{ color: c.accent }}>
            Back
          </T>
        </Pressable>
        <IconButton icon="pin" label={lead.pinned ? 'Unpin from Today' : 'Pin to Today'} onPress={() => togglePin(lead.id)} />
      </Row>

      <View style={{ alignItems: 'center', gap: 4, marginBottom: 4 }}>
        <Avatar initials={initials(lead)} size={72} />
        <T w="bold" size={26} style={{ marginTop: 6 }}>
          {lead.firstName} {lead.lastName}
        </T>
        <Row gap={6}>
          <Dot color={color} />
          <T size={14} tone="body">
            {STATUS_TEXT[label].toLowerCase() === lead.stage.toLowerCase() ? lead.stage : `${STATUS_TEXT[label]} · ${lead.stage}`}
          </T>
        </Row>
        <T size={12} tone="sub">
          {lead.touches} touches · {lead.lastContactAt ? `last contact ${relTime(lead.lastContactAt)}` : 'never contacted'} · {lead.crm === 'manual' ? 'added in Back 40' : `synced with ${SOURCE_NAME[lead.crm]}`}
        </T>
      </View>

      <Row gap={8}>
        {action('phone', 'Call', () => callLead(lead))}
        {action('text', 'Text', () => textLead(lead))}
        {action('mail', 'Email', () => router.push(`/compose/${lead.id}?channel=email`))}
      </Row>

      <SectionLabel>Why now</SectionLabel>
      <Card style={{ gap: 4 }}>
        <T size={16}>{lead.aiWhyNow ?? (lead.crm === 'manual' ? (lead.lastContactAt ? `You last reached out ${relTime(lead.lastContactAt)}.` : 'You added this lead. Make the first call.') : 'Recent activity in your CRM.')}</T>
        {lead.aiOpener ? (
          <T size={14} tone="sub">
            Try opening with "{lead.aiOpener}"
          </T>
        ) : null}
      </Card>

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
          style={{ flex: 1, minHeight: 44, maxHeight: 120, ...font('medium'), fontSize: 15, color: c.text, backgroundColor: c.card, borderRadius: 22, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10, textAlignVertical: 'top' }}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Save note to CRM"
          disabled={!note.trim()}
          onPress={() => { addNote(lead.id, note.trim()); setNote(''); }}
          style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: note.trim() ? c.text : c.soft, alignItems: 'center', justifyContent: 'center' }}>
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
