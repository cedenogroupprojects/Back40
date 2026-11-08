// Hot & warm — only the people worth staying in front of. Everyone else stays
// in the CRM and is reachable by search (pin them to put them back on the list).
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';

import { hotAndWarm, type Lead, type RankedLead } from '@back40/core';

import { Icon } from '@/components/Icon';
import { LeadRow } from '@/components/LeadRow';
import { List, ListRow, Screen, SectionLabel, T } from '@/components/ui';
import { money, relTime, useStore } from '@/data/store';
import { useTheme } from '@/theme/ThemeProvider';
import { font } from '@/theme/tokens';

export default function Leads() {
  const { c } = useTheme();
  const { leads, settings, togglePin } = useStore();
  const [q, setQ] = useState('');
  const now = Date.now();
  const { hot, warm } = useMemo(() => hotAndWarm(leads, settings.rules, now), [leads, settings.rules, now]);

  const sum = (rs: RankedLead[]) => rs.reduce((t, r) => t + (r.lead.fields.potentialCommission ?? 0), 0);
  const hotMoney = sum(hot);
  const warmMoney = sum(warm);

  const term = q.trim().toLowerCase();
  const match = (l: Lead) => `${l.firstName} ${l.lastName} ${l.phone ?? ''}`.toLowerCase().includes(term);
  const shownIds = new Set([...hot, ...warm].map((r) => r.lead.id));
  const elsewhere = term ? leads.filter((l) => !shownIds.has(l.id) && match(l)) : [];
  const hotList = term ? hot.filter((r) => match(r.lead)) : hot;
  const warmList = term ? warm.filter((r) => match(r.lead)) : warm;

  const Amount = ({ l }: { l: Lead }) => {
    const v = l.fields.potentialCommission;
    return (
      <Pressable accessibilityRole="button" accessibilityLabel={v ? `Potential commission ${money(v, false)}. Edit` : `Add potential commission for ${l.firstName}`} onPress={() => router.push(`/commission/${l.id}`)} hitSlop={8} style={{ minWidth: 52, alignItems: 'flex-end' }}>
        <T w={v ? 'semibold' : 'medium'} size={14} style={{ color: v ? c.good : c.accentText }}>
          {v ? money(v) : 'Add $'}
        </T>
      </Pressable>
    );
  };

  return (
    <Screen title="Hot & warm" kicker={`${hot.length} hot · ${warm.length} warm`}>
      <List>
        <ListRow
          label="Potential commission"
          value={money(hotMoney + warmMoney, false)}
          valueTone={c.good}
          sub={`${money(hotMoney)} hot · ${money(warmMoney)} warm`}
        />
      </List>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: c.soft, borderRadius: 10, paddingHorizontal: 10, minHeight: 38 }}>
        <Icon name="search" size={16} color={c.sub} />
        <TextInput value={q} onChangeText={setQ} placeholder="Search your CRM" placeholderTextColor={c.sub} accessibilityLabel="Search leads" style={[font('regular'), { flex: 1, fontSize: 16, color: c.text, minHeight: 38 }]} />
      </View>

      {hotList.length ? (
        <>
          <SectionLabel>Hot</SectionLabel>
          <List inset={36}>
            {hotList.map((r) => (
              <LeadRow key={r.lead.id} item={r} lines={1} right={<Amount l={r.lead} />} />
            ))}
          </List>
        </>
      ) : null}

      {warmList.length ? (
        <>
          <SectionLabel>Warm</SectionLabel>
          <List inset={36}>
            {warmList.map((r) => (
              <LeadRow key={r.lead.id} item={r} lines={1} right={<Amount l={r.lead} />} />
            ))}
          </List>
        </>
      ) : null}

      {elsewhere.length ? (
        <>
          <SectionLabel>Also in your CRM</SectionLabel>
          <List>
            {elsewhere.map((l) => (
              <ListRow
                key={l.id}
                label={`${l.firstName} ${l.lastName}`}
                sub={`${l.stage} · last contact ${relTime(l.lastContactAt)}`}
                right={
                  <Pressable accessibilityRole="button" accessibilityLabel={l.pinned ? `Unpin ${l.firstName}` : `Pin ${l.firstName} to Today`} onPress={() => togglePin(l.id)} hitSlop={8}>
                    <T w="medium" size={14} tone="accent">
                      {l.pinned ? 'Pinned' : 'Pin'}
                    </T>
                  </Pressable>
                }
              />
            ))}
          </List>
          <T size={12} tone="sub" style={{ paddingHorizontal: 16 }}>
            Not hot right now. Pin someone to put them back on your list.
          </T>
        </>
      ) : null}

      {term && !hotList.length && !warmList.length && !elsewhere.length ? (
        <T tone="sub" style={{ textAlign: 'center', marginTop: 12 }}>
          No one by that name.
        </T>
      ) : null}
    </Screen>
  );
}
