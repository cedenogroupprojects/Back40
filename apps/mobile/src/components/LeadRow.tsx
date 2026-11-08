// One lead in a grouped list: status dot, name + status, why-now line, time
// since activity, and a call button. Tap opens the lead; hold to pin to Today.
import { router } from 'expo-router';
import { Pressable, View } from 'react-native';

import type { RankedLead } from '@back40/core';

import { useStore } from '@/data/store';
import { callLead } from '@/lib/actions';
import { since, STATUS_TEXT, statusColor } from '@/lib/status';
import { useTheme } from '@/theme/ThemeProvider';
import { Icon } from './Icon';
import { CallButton, Dot, Row, T } from './ui';

export function LeadRow({ item, right, lines = 2 }: { item: RankedLead; right?: React.ReactNode; lines?: number }) {
  const { c } = useTheme();
  const { togglePin } = useStore();
  const { lead, label } = item;
  const color = statusColor(label, c);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${lead.firstName} ${lead.lastName}, ${STATUS_TEXT[label]}`}
      accessibilityHint="Opens the lead. Hold to pin it to Today."
      onPress={() => router.push(`/lead/${lead.id}`)}
      onLongPress={() => togglePin(lead.id)}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: 16, paddingRight: 12, paddingVertical: 11, backgroundColor: pressed ? c.soft : 'transparent' })}>
      <Dot color={color} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Row gap={6}>
          <T w="semibold" size={16} numberOfLines={1} style={{ flexShrink: 1 }}>
            {lead.firstName} {lead.lastName}
          </T>
          {label !== 'hot_now' ? (
            <T w="medium" size={13} style={{ color }}>
              {STATUS_TEXT[label]}
            </T>
          ) : null}
          {lead.pinned ? <Icon name="pin" size={12} color={c.sub} /> : null}
          <View style={{ flex: 1 }} />
          <T size={12} tone="sub">
            {since(lead)}
          </T>
        </Row>
        <T size={14} tone="sub" numberOfLines={lines} style={{ marginTop: 1 }}>
          {item.reason}
        </T>
      </View>
      {right ?? <CallButton label={`Call ${lead.firstName}`} onPress={() => callLead(lead)} />}
    </Pressable>
  );
}
