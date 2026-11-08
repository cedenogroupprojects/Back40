// Onboarding — under 5 minutes: connect CRM → pick hot stages → daily goal →
// notifications → "Build my hot sheet".
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import type { CrmKind } from '@back40/core';

import { ParcelMark } from '@/components/Icon';
import { Card, Chip, List, ListRow, Pill, Row, Screen, T } from '@/components/ui';
import { STAGES } from '@/data/sample';
import { useStore } from '@/data/store';
import { CRM_NAME } from '@/lib/crm';
import { useTheme } from '@/theme/ThemeProvider';

const COUNTS: Record<string, number> = { 'New Lead': 12, Contacted: 38, 'Sent to Lender': 9, 'Pre-Approved': 7, 'Actively Looking': 11, 'Submitting Offers': 3, 'In Escrow': 2, Nurture: 140, 'Past Client': 63 };

export default function Onboarding() {
  const { c } = useTheme();
  const { settings, finishOnboarding } = useStore();
  const [step, setStep] = useState(0);
  const [crm, setCrm] = useState<CrmKind | null>(settings.crm);
  const [stages, setStages] = useState<string[]>(['New Lead', 'Pre-Approved', 'Actively Looking', 'Submitting Offers']);
  const [goal, setGoal] = useState(6);

  const dots = (
    <Row gap={6}>
      {[0, 1, 2].map((i) => (
        <View key={i} style={{ width: i === step ? 28 : 6, height: 6, borderRadius: 3, backgroundColor: i === step ? c.accent : c.track }} />
      ))}
    </Row>
  );

  const finish = () => {
    finishOnboarding({ crm, dailyGoal: goal, rules: { ...settings.rules, hotStages: stages } });
    router.back();
  };

  return (
    <Screen bottomSpace={40}>
      <Row style={{ justifyContent: 'space-between' }}>
        <ParcelMark size={30} line={c.text} cell={c.accent} />
        {dots}
      </Row>

      {step === 0 ? (
        <>
          <T w="heavy" size={26} style={{ letterSpacing: -0.4, lineHeight: 31 }}>
            Let's find your best leads.
          </T>
          <T tone="body">Connect the CRM you already use. We read your leads and save your calls and notes back. Nothing leaves your CRM.</T>
          <List>
            {(['lofty', 'followupboss', 'gohighlevel'] as const).map((k) => (
              <ListRow key={k} label={CRM_NAME[k]} value={crm === k ? 'Connected' : 'Connect'} valueTone={crm === k ? c.good : c.accentText} onPress={() => setCrm(k)} />
            ))}
          </List>
          <Pill label="Continue" size="lg" disabled={!crm} onPress={() => setStep(1)} />
        </>
      ) : step === 1 ? (
        <>
          <T w="heavy" size={26} style={{ letterSpacing: -0.4, lineHeight: 31 }}>
            Which leads count as hot?
          </T>
          <T tone="body">We found these stages in {crm ? CRM_NAME[crm] : 'your CRM'}. Leads in checked stages can show up on Today.</T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {STAGES.map((s) => (
              <Chip key={s} label={`${s} · ${COUNTS[s] ?? 0}`} on={stages.includes(s)} onPress={() => setStages((x) => (x.includes(s) ? x.filter((y) => y !== s) : [...x, s]))} />
            ))}
          </View>
          <T size={13} tone="sub">
            New leads and anyone with fresh activity always make the list too.
          </T>
          <Pill label="Continue" size="lg" disabled={!stages.length} onPress={() => setStep(2)} />
        </>
      ) : (
        <>
          <T w="heavy" size={26} style={{ letterSpacing: -0.4, lineHeight: 31 }}>
            Set your daily goal.
          </T>
          <T tone="body">Hit it every day to build your streak. Your score climbs when hot leads get a call fast.</T>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 24, paddingVertical: 8 }}>
            <Pressable accessibilityRole="button" accessibilityLabel="Fewer calls" onPress={() => setGoal((g) => Math.max(1, g - 1))} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: c.soft, alignItems: 'center', justifyContent: 'center' }}>
              <T w="bold" size={22}>−</T>
            </Pressable>
            <View style={{ alignItems: 'center', minWidth: 80 }}>
              <T w="heavy" size={40}>{goal}</T>
              <T size={13} tone="sub">calls a day</T>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="More calls" onPress={() => setGoal((g) => Math.min(50, g + 1))} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: c.soft, alignItems: 'center', justifyContent: 'center' }}>
              <T w="bold" size={22}>+</T>
            </Pressable>
          </View>
          <Card tint={c.soft}>
            <T w="heavy">Turn on notifications</T>
            <T size={14} tone="body">
              Your list arrives at 7:30 AM, and you hear about new leads within a minute.
            </T>
          </Card>
          <Pill label="Build my hot sheet" size="lg" onPress={finish} />
        </>
      )}
    </Screen>
  );
}
