// Potential commission: purchase price × commission %. The agent enters both;
// the app does the math. It adds up at the top of Hot & warm and on Pipeline.
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Pill, Row, T } from '@/components/ui';
import { money, useStore } from '@/data/store';
import { tap } from '@/lib/actions';
import { useTheme } from '@/theme/ThemeProvider';
import { font } from '@/theme/tokens';

const digits = (s: string) => Number(s.replace(/[^0-9]/g, '')) || 0;
/** Keeps one decimal point and up to 3 decimals: "2.5", "2.75". */
const rateText = (s: string) => {
  const [a = '', ...rest] = s.replace(/[^0-9.]/g, '').split('.');
  return rest.length ? `${a}.${rest.join('').slice(0, 3)}` : a;
};

export default function Commission() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const { lead: get, setCommission } = useStore();
  const lead = get(id);
  const f = lead?.fields;
  const [price, setPrice] = useState(String(f?.purchasePrice ?? f?.budgetMax ?? ''));
  const [rate, setRate] = useState(f?.commissionRate != null ? String(f.commissionRate) : '');
  if (!lead) return null;

  const p = digits(price);
  const r = Number(rate) || 0;
  const amount = Math.round((p * r) / 100);

  const save = (v: number | null) => {
    tap();
    setCommission(lead.id, v, v ? { price: p, rate: r } : undefined);
    router.back();
  };

  const input = { ...font('semibold'), fontSize: 17, color: c.text, textAlign: 'right', minWidth: 0, flex: 1, paddingVertical: 0 } as const;
  const line = { minHeight: 52, justifyContent: 'space-between', paddingHorizontal: 16 } as const;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <Pressable accessibilityLabel="Close" onPress={() => router.back()} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' }} />
      <View style={{ backgroundColor: c.bg, borderTopLeftRadius: 6, borderTopRightRadius: 6, paddingHorizontal: 20, paddingTop: 10, paddingBottom: insets.bottom + 16, gap: 14 }}>
        <View style={{ alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: c.track }} />
        <View style={{ gap: 2 }}>
          <T w="heavy" size={19}>
            Potential commission
          </T>
          <T size={14} tone="sub">
            If {lead.firstName} closes
          </T>
        </View>

        <View style={{ backgroundColor: c.card, borderRadius: 6, overflow: 'hidden' }}>
          <Row style={line}>
            <T size={15} tone="body">
              Purchase price
            </T>
            <Row gap={2} style={{ flex: 1, justifyContent: 'flex-end' }}>
              <TextInput
                value={p ? `$${p.toLocaleString('en-US')}` : ''}
                onChangeText={setPrice}
                keyboardType="number-pad"
                placeholder="$650,000"
                placeholderTextColor={c.sub}
                autoFocus={!p}
                accessibilityLabel="Purchase price in dollars"
                style={[input, { maxWidth: 160 }]}
              />
            </Row>
          </Row>
          <View style={{ height: 1, backgroundColor: c.track, marginLeft: 16 }} />
          <Row style={line}>
            <T size={15} tone="body">
              Commission
            </T>
            <Row gap={2} style={{ flex: 1, justifyContent: 'flex-end' }}>
              <TextInput
                value={rate}
                onChangeText={(t) => setRate(rateText(t))}
                keyboardType="decimal-pad"
                placeholder="2.5"
                placeholderTextColor={c.sub}
                autoFocus={!!p}
                accessibilityLabel="Commission percent"
                style={[input, { maxWidth: 70 }]}
              />
              <T w="semibold" size={17} tone={rate ? undefined : 'sub'}>
                %
              </T>
            </Row>
          </Row>
          <View style={{ height: 1, backgroundColor: c.track, marginLeft: 16 }} />
          <Row style={line}>
            <T size={15} tone="body">
              You'd earn
            </T>
            <T w="heavy" size={17} style={{ color: amount ? c.good : c.sub }}>
              {money(amount, false)}
            </T>
          </Row>
        </View>

        <Row gap={10}>
          {f?.potentialCommission ? <Pill label="Remove" kind="soft" onPress={() => save(null)} style={{ flex: 1 }} /> : null}
          <Pill label="Save" disabled={!amount} onPress={() => save(amount)} style={{ flex: 2 }} />
        </Row>
      </View>
    </KeyboardAvoidingView>
  );
}
