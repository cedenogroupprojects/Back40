// Page 3 — After the call. Defaults (confirmed Nov 8, adjustable later):
// - AI-pulled fields are shown first and saved with one tap (never silently).
// - No call recording; the agent talks a short voice note after the call.
// - Closing without logging still logs "call attempted" so timers stay honest.
// - After "We talked", a recap text is OFFERED, never sent automatically.
// - Every attempt earns points; a conversation earns more.
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { pointsFor, type CallOutcome } from '@back40/core';

import { Icon } from '@/components/Icon';
import { Card, Chip, Pill, Row, T } from '@/components/ui';
import { extractFromNote, SAMPLE_TRANSCRIPT } from '@/data/demoAi';
import { useStore } from '@/data/store';
import { tap } from '@/lib/actions';
import { CRM_NAME } from '@/lib/crm';
import { useTheme } from '@/theme/ThemeProvider';
import { font } from '@/theme/tokens';

const OUTCOMES: { key: CallOutcome; label: string }[] = [
  { key: 'talked', label: 'Talked' },
  { key: 'voicemail', label: 'Voicemail' },
  { key: 'no_answer', label: 'No answer' },
];

function dateFor(choice: string): string | null {
  const d = new Date();
  d.setHours(10, 0, 0, 0);
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  if (choice === 'Tomorrow' || choice === 'tomorrow') d.setDate(d.getDate() + 1);
  else if (choice === 'In 3 days') d.setDate(d.getDate() + 3);
  else if (choice === 'Next week') d.setDate(d.getDate() + 7);
  else {
    const target = days.indexOf(choice.toLowerCase());
    if (target < 0) return null;
    d.setDate(d.getDate() + (((target - d.getDay() + 7) % 7) || 7));
  }
  return d.toISOString();
}

export default function LogCall() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const { lead: get, logCall, sendMessage } = useStore();
  const lead = get(id);
  const [outcome, setOutcome] = useState<CallOutcome>('talked');
  const [transcript, setTranscript] = useState('');
  const [recording, setRecording] = useState(false);
  const [useFields, setUseFields] = useState(true);
  const [useStage, setUseStage] = useState(true);
  const [remind, setRemind] = useState<string | null>(null);
  const [saved, setSaved] = useState<number | null>(null);
  const [recapSent, setRecapSent] = useState(false);
  const logged = useRef(false);

  const ex = useMemo(() => (lead && transcript ? extractFromNote(transcript, lead) : null), [transcript, lead]);
  if (!lead) return null;
  const suggested = ex?.followUpDay ? ex.followUpDay[0]!.toUpperCase() + ex.followUpDay.slice(1) : null;
  const remindOptions = ['Tomorrow', ...(suggested && suggested !== 'Tomorrow' ? [suggested] : []), 'In 3 days', 'Next week'];
  const chosen = remind ?? suggested ?? 'Tomorrow';
  const fieldLines = ex
    ? [
        ex.fields.budgetMax ? `Budget up to $${Math.round(ex.fields.budgetMax / 1000)}K` : null,
        ex.fields.beds ? `${ex.fields.beds} bedrooms` : null,
        ex.fields.preApproved ? 'Pre-approved' : null,
      ].filter(Boolean)
    : [];

  const record = () => {
    tap();
    setRecording(true);
    // Production: expo-audio records → `ai` function transcribes + extracts.
    setTimeout(() => {
      setRecording(false);
      setTranscript(SAMPLE_TRANSCRIPT[lead.id] ?? 'Talked through options. Wants to look again next week.');
    }, 1200);
  };

  const save = () => {
    logged.current = true;
    const pts = logCall({
      leadId: lead.id,
      outcome,
      note: ex?.note || transcript || undefined,
      fields: useFields ? ex?.fields : undefined,
      followUpAt: dateFor(chosen),
      stageChange: useStage ? ex?.stageChange ?? null : null,
    });
    setSaved(pts);
  };

  const close = () => {
    if (!logged.current && saved === null) logCall({ leadId: lead.id, outcome: 'attempted' }); // keep timers honest
    router.back();
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.dim }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={close} style={{ height: insets.top + 70, paddingTop: insets.top + 18, paddingHorizontal: 20 }}>
        <T w="semibold" size={14} style={{ color: '#FFFFFF' }}>
          Call with {lead.firstName} {lead.lastName}
        </T>
      </Pressable>
      <View style={{ flex: 1, backgroundColor: c.bg, borderTopLeftRadius: 28, borderTopRightRadius: 28, overflow: 'hidden' }}>
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 30, gap: 16 }}>
          <View style={{ alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: c.track }} />

          {saved !== null ? (
            <View style={{ gap: 16 }}>
              <T w="heavy" size={22}>
                Saved to {CRM_NAME[lead.crm]}.
              </T>
              <View style={{ alignSelf: 'flex-start', backgroundColor: c.goodSoft, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14 }}>
                <T w="heavy" size={13} tone="good">
                  +{saved} to today's score
                </T>
              </View>
              <T tone="body">
                Logged the call, your note{useFields && fieldLines.length ? ', updated fields' : ''} and a follow-up for {chosen}.
              </T>
              {outcome === 'talked' && ex?.recap && !recapSent ? (
                <Card>
                  <Row gap={6}>
                    <T w="heavy" size={14}>
                      Send a recap text?
                    </T>
                  </Row>
                  <T size={15} style={{ backgroundColor: c.soft, borderRadius: 14, padding: 12 }}>
                    {ex.recap}
                  </T>
                  <Row>
                    <Pill label="Edit" kind="soft" onPress={() => router.replace(`/compose/${lead.id}?body=${encodeURIComponent(ex.recap ?? '')}`)} style={{ flex: 1 }} />
                    <Pill label="Send" onPress={() => { sendMessage(lead.id, 'text', ex.recap ?? ''); setRecapSent(true); }} style={{ flex: 2 }} />
                  </Row>
                </Card>
              ) : recapSent ? (
                <T w="bold" tone="good">
                  Recap sent through {CRM_NAME[lead.crm]}.
                </T>
              ) : null}
              <Pill label="Done" kind="ink" onPress={() => router.back()} />
            </View>
          ) : (
            <>
              <Row style={{ justifyContent: 'space-between' }}>
                <T w="heavy" size={21} style={{ flex: 1 }}>
                  How'd it go?
                </T>
                <View style={{ backgroundColor: c.goodSoft, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12 }}>
                  <T w="heavy" size={12} tone="good">
                    +{pointsFor(outcome)}
                  </T>
                </View>
              </Row>

              <View style={{ flexDirection: 'row', backgroundColor: c.soft, borderRadius: 14, padding: 3 }}>
                {OUTCOMES.map((o) => {
                  const on = outcome === o.key;
                  return (
                    <Pressable
                      key={o.key}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: on }}
                      onPress={() => { tap(); setOutcome(o.key); }}
                      style={{ flex: 1, minHeight: 40, borderRadius: 11, backgroundColor: on ? c.card : 'transparent', alignItems: 'center', justifyContent: 'center', boxShadow: on ? '0 1px 3px rgba(0,0,0,0.12)' : undefined }}>
                      <T w={on ? 'bold' : 'medium'} size={14} style={{ color: on ? c.text : c.sub }}>
                        {o.label}
                      </T>
                    </Pressable>
                  );
                })}
              </View>

              <Card>
                <Row gap={12} style={{ alignItems: 'flex-start' }}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Record a voice note"
                    onPress={record}
                    style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: recording ? c.text : c.accent, alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name="mic" size={20} color={recording ? c.bg : c.onAccent} />
                  </Pressable>
                  <View style={{ flex: 1, gap: 4 }}>
                    <T w="bold" size={13} tone="sub">
                      {recording ? 'Listening…' : transcript ? 'Your voice note' : 'Tap and talk for 20 seconds'}
                    </T>
                    <TextInput
                      value={transcript}
                      onChangeText={setTranscript}
                      placeholder="…or type it"
                      placeholderTextColor={c.sub}
                      multiline
                      accessibilityLabel="Call note"
                      style={{ ...font('medium'), fontSize: 15, color: c.text, minHeight: 40 }}
                    />
                  </View>
                </Row>
              </Card>

              {ex && (fieldLines.length || ex.stageChange) ? (
                <Card tint={c.soft}>
                  <Row gap={6}>
                    <T w="heavy" size={14}>
                      We heard
                    </T>
                  </Row>
                  {fieldLines.length ? (
                    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: useFields }} onPress={() => setUseFields((v) => !v)}>
                      <Row>
                        <Icon name={useFields ? 'check' : 'close'} size={16} color={useFields ? c.good : c.sub} />
                        <T size={15}>{fieldLines.join(' · ')}</T>
                      </Row>
                    </Pressable>
                  ) : null}
                  {ex.stageChange ? (
                    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: useStage }} onPress={() => setUseStage((v) => !v)}>
                      <Row>
                        <Icon name={useStage ? 'check' : 'close'} size={16} color={useStage ? c.good : c.sub} />
                        <T size={15}>
                          Move stage: {lead.stage} → {ex.stageChange}
                        </T>
                      </Row>
                    </Pressable>
                  ) : null}
                  <T size={12} tone="sub">
                    Tap a line to leave it out. Saved to your CRM only when you save.
                  </T>
                </Card>
              ) : null}

              <T w="heavy">Remind me</T>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {remindOptions.map((o) => (
                  <Chip key={o} label={o === suggested ? `${o} ✦` : o} on={chosen === o} onPress={() => setRemind(o)} />
                ))}
              </View>

              <Pill label={`Save to ${CRM_NAME[lead.crm]}`} size="lg" onPress={save} style={{ marginTop: 8 }} />
              <Pressable accessibilityRole="button" onPress={close} style={{ alignSelf: 'center', padding: 10 }}>
                <T w="semibold" tone="sub">
                  Skip — log as attempted
                </T>
              </Pressable>
            </>
          )}
        </ScrollView>
      </View>
    </View>
  );
}
