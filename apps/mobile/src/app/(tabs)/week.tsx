// Week — calls per day, streak, score, and recent nudges.
import { router } from 'expo-router';
import { Pressable, View } from 'react-native';

import { Icon, type IconName } from '@/components/Icon';
import { Card, List, ListRow, Row, Screen, SectionLabel, T } from '@/components/ui';
import { useStore, type Nudge } from '@/data/store';
import { useTheme } from '@/theme/ThemeProvider';

const DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const NUDGE_ICON: Record<Nudge['kind'], IconName> = { new_lead: 'bolt', morning: 'sun', cold: 'clock', crm: 'note' };

export default function Week() {
  const { c } = useTheme();
  const { week, nudges, streak, score } = useStore();
  const total = week.reduce((a, b) => a + b, 0);
  const max = Math.max(...week, 1);
  const todayIdx = week.length - 1;

  return (
    <Screen title="Week" kicker="Mon – Sun">
      <Card style={{ gap: 12 }}>
        <Row style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <View>
            <T w="bold" size={28}>
              {total}
            </T>
            <T size={13} tone="sub">
              calls this week
            </T>
          </View>
          <T w="medium" size={13} tone="good">
            +9 vs last week
          </T>
        </Row>
        <View style={{ height: 84, flexDirection: 'row', alignItems: 'flex-end', gap: 8 }} accessibilityLabel={`Calls per day: ${week.join(', ')}`}>
          {DAYS.map((d, i) => (
            <View key={i} style={{ flex: 1, alignItems: 'center', gap: 6 }}>
              <View style={{ width: '100%', height: i < week.length ? Math.max(3, (week[i]! / max) * 64) : 3, borderRadius: 4, backgroundColor: i === todayIdx ? c.accent : c.soft }} />
              <T w="medium" size={11} tone="sub">
                {d}
              </T>
            </View>
          ))}
        </View>
      </Card>

      <List>
        <ListRow label="Streak" value={`${streak} days`} />
        <ListRow label="Today's score" value={String(score)} />
      </List>

      <SectionLabel>Nudges</SectionLabel>
      <List inset={52}>
        {nudges.map((n) => (
          <Pressable key={n.id} accessibilityRole="button" disabled={!n.leadId} onPress={() => n.leadId && router.push(`/lead/${n.leadId}`)} style={({ pressed }) => ({ flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingVertical: 11, backgroundColor: pressed ? c.soft : 'transparent' })}>
            <View style={{ width: 24, alignItems: 'center', paddingTop: 2 }}>
              <Icon name={NUDGE_ICON[n.kind]} size={18} color={n.kind === 'new_lead' ? c.accent : n.kind === 'cold' ? c.sub : c.cool} />
            </View>
            <View style={{ flex: 1 }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <T w="semibold" size={15}>
                  {n.title}
                </T>
                <T size={12} tone="sub">
                  {n.when}
                </T>
              </Row>
              <T size={14} tone="sub">
                {n.body}
              </T>
            </View>
          </Pressable>
        ))}
      </List>
    </Screen>
  );
}
