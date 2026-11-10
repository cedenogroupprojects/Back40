// Nurture settings: Back 40 keeps in touch with every lead that isn't on Today.
// One question to answer (approve each morning, or send automatically); the rest
// has sensible defaults so any agent can turn it on in a tap.
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Switch, TextInput, View } from 'react-native';

import { Card, Chip, List, ListRow, NavBar, Pill, Row, Screen, SectionLabel, Segmented, T } from '@/components/ui';
import { useStore } from '@/data/store';
import { fetchNurture, NURTURE_DEFAULTS, runNurtureNow, saveNurture, type NurtureSettings } from '@/data/supabase';
import { tap } from '@/lib/actions';
import { useTheme } from '@/theme/ThemeProvider';
import { font } from '@/theme/tokens';

const LIMITS = [5, 10, 15, 25];

export default function Nurture() {
  const { c } = useTheme();
  const { profile, isLiveMode, reload } = useStore();
  const [s, setS] = useState<NurtureSettings>(NURTURE_DEFAULTS);
  const [stats, setStats] = useState<{ active: number; dueThisWeek: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isLiveMode || !profile) return setLoading(false);
    try {
      const r = await fetchNurture(profile.orgId, profile.userId);
      setS(r.settings);
      setStats({ active: r.active, dueThisWeek: r.dueThisWeek });
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [isLiveMode, profile]);
  useEffect(() => void load(), [load]);

  const update = (patch: Partial<NurtureSettings>) => {
    tap();
    const next = { ...s, ...patch };
    setS(next);
    if (isLiveMode && profile) saveNurture(profile.orgId, profile.userId, next).catch((e: Error) => setNote(e.message));
  };

  const toggleChannel = (ch: 'text' | 'email', on: boolean) => {
    const set = new Set(s.channels);
    if (on) set.add(ch);
    else set.delete(ch);
    if (!set.size) return; // keep at least one way to reach people
    update({ channels: [...set] as ('text' | 'email')[] });
  };

  const runNow = async () => {
    setRunning(true);
    setNote(null);
    try {
      if (!s.enabled) update({ enabled: true });
      const r = await runNurtureNow(Math.min(s.dailyLimit, 10));
      await reload();
      await load();
      if (r.drafted > 0) router.push('/approve');
      else setNote('Nobody is due right now. New messages show up each morning.');
    } catch (e) {
      setNote((e as Error).message || 'Could not write messages. Try again in a minute.');
    } finally {
      setRunning(false);
    }
  };

  const crmCanSend = profile?.crm?.kind !== 'followupboss';

  return (
    <Screen bottomSpace={48}>
      <NavBar back onClose={() => router.back()} />
      <View style={{ paddingHorizontal: 4, gap: 4 }}>
        <T w="bold" size={30}>
          Nurture
        </T>
        <T size={15} tone="sub">
          Back 40 stays in touch with every lead that isn’t on Today. One short, personal message at a time, usually with a home that fits them.
        </T>
      </View>

      {loading ? (
        <ActivityIndicator color={c.sub} style={{ marginTop: 24 }} />
      ) : (
        <>
          <List>
            <ListRow
              label="Keep in touch for me"
              sub={s.enabled ? (stats ? `${stats.active} leads in nurture · ${stats.dueThisWeek} due this week` : 'On') : 'Off'}
              right={
                <Switch
                  value={s.enabled}
                  onValueChange={(v) => update({ enabled: v })}
                  accessibilityLabel="Keep in touch for me"
                  trackColor={{ true: c.accent, false: c.track }}
                  thumbColor="#FFFFFF"
                  {...({ activeThumbColor: '#FFFFFF' } as object)}
                />
              }
            />
          </List>

          {!crmCanSend ? (
            <T size={13} tone="sub" style={{ paddingHorizontal: 16 }}>
              Follow Up Boss doesn’t let apps send texts, so nurture messages open on your phone to send. Everything else works the same.
            </T>
          ) : null}

          <SectionLabel>How messages go out</SectionLabel>
          <Segmented<'approve' | 'auto'>
            options={[
              { key: 'approve', label: 'I approve each' },
              { key: 'auto', label: 'Send for me' },
            ]}
            value={s.mode}
            onChange={(m) => update({ mode: m })}
          />
          <T size={13} tone="sub" style={{ paddingHorizontal: 16 }}>
            {s.mode === 'approve'
              ? 'Each morning, today’s messages wait in “Ready for you.” Read, edit, skip or send. Nothing goes out without you.'
              : 'Messages send from your CRM between 9 AM and 7 PM. Texts only go to leads whose consent your CRM recorded.'}
          </T>

          <SectionLabel>Messages per day</SectionLabel>
          <Row gap={6}>
            {LIMITS.map((n) => (
              <Chip key={n} label={String(n)} on={s.dailyLimit === n} onPress={() => update({ dailyLimit: n })} />
            ))}
          </Row>

          <SectionLabel>Send by</SectionLabel>
          <List>
            {(['text', 'email'] as const).map((ch) => (
              <ListRow
                key={ch}
                label={ch === 'text' ? 'Text' : 'Email'}
                sub={ch === 'text' ? 'First choice when they have a phone number' : 'When texting isn’t an option'}
                right={
                  <Switch
                    value={s.channels.includes(ch)}
                    onValueChange={(v) => toggleChannel(ch, v)}
                    accessibilityLabel={ch === 'text' ? 'Text' : 'Email'}
                    trackColor={{ true: c.accent, false: c.track }}
                    thumbColor="#FFFFFF"
                    {...({ activeThumbColor: '#FFFFFF' } as object)}
                  />
                }
              />
            ))}
          </List>

          <SectionLabel>Your website</SectionLabel>
          <List>
            <View style={{ minHeight: 48, justifyContent: 'center', paddingHorizontal: 16 }}>
              <TextInput
                defaultValue={s.websiteUrl ?? ''}
                onEndEditing={(e) => update({ websiteUrl: e.nativeEvent.text.trim() || null })}
                onBlur={(e) => Platform.OS === 'web' && update({ websiteUrl: ((e.target as unknown as { value?: string }).value ?? '').trim() || null })}
                placeholder="yourname.lofty.com (optional)"
                placeholderTextColor={c.sub}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                accessibilityLabel="Your website"
                style={[font('regular'), { fontSize: 16, color: c.text, paddingVertical: 0, outlineWidth: 0 }]}
              />
            </View>
          </List>
          <T size={13} tone="sub" style={{ paddingHorizontal: 16 }}>
            Home links point here so their clicks show up in your CRM.
          </T>

          <Card style={{ gap: 6 }}>
            <T w="semibold" size={15}>
              What every message looks like
            </T>
            <T size={14} tone="body">
              One lead, one thing worth their time: a home that fits, a new-build community, or one easy question when we don’t know what they want yet. Never “just checking in.”
            </T>
            <T size={14} tone="body">
              How often depends on their timeline: weekly if they’re buying in 0–3 months, monthly at 6–12. Do-not-text and do-not-email are always respected.
            </T>
          </Card>

          {note ? (
            <T size={14} tone="accent" style={{ paddingHorizontal: 4, textAlign: 'center' }}>
              {note}
            </T>
          ) : null}

          {isLiveMode ? <Pill label={running ? 'Writing messages…' : 'Write today’s messages now'} size="lg" disabled={running} onPress={runNow} /> : null}
        </>
      )}
    </Screen>
  );
}
