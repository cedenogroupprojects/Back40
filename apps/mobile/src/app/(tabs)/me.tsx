// Me — connections and the rules that decide what counts as hot.
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, Switch, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { Avatar, Card, Chip, List, ListRow, Pill, Row, Screen, SectionLabel, Segmented, T } from '@/components/ui';
import { STAGES } from '@/data/sample';
import { relTime, useStore, type Settings } from '@/data/store';
import * as live from '@/data/supabase';
import { CRM_NAME } from '@/lib/crm';
import { useTheme, type ThemeMode } from '@/theme/ThemeProvider';

function Section({ title, note, children, plain }: { title: string; note?: string; children: ReactNode; plain?: boolean }) {
  return (
    <View style={{ gap: 6 }}>
      <SectionLabel>{title}</SectionLabel>
      <View style={{ marginTop: 4 }}>{plain ? children : <List>{children}</List>}</View>
      {note ? (
        <T size={12} tone="sub" style={{ paddingHorizontal: 16 }}>
          {note}
        </T>
      ) : null}
    </View>
  );
}

function Toggle({ label, value, onChange, sub }: { label: string; value: boolean; onChange: (v: boolean) => void; sub?: string }) {
  const { c } = useTheme();
  return (
    <ListRow
      label={label}
      sub={sub}
      right={<Switch value={value} onValueChange={onChange} accessibilityLabel={label} trackColor={{ true: c.accent, false: c.track }} thumbColor="#FFFFFF" {...({ activeThumbColor: '#FFFFFF' } as object)} />}
    />
  );
}

function Stepper({ value, onChange, disabled }: { value: number; onChange: (v: number) => void; disabled?: boolean }) {
  const { c } = useTheme();
  const btn = (label: string, d: number, a11y: string) => (
    <Pressable accessibilityRole="button" accessibilityLabel={a11y} disabled={disabled} onPress={() => onChange(Math.min(50, Math.max(1, value + d)))} hitSlop={6} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: c.soft, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.4 : 1 }}>
      <T w="bold" size={17}>
        {label}
      </T>
    </Pressable>
  );
  return (
    <Row gap={10}>
      {btn('−', -1, 'Fewer calls')}
      <T w="bold" size={16} style={{ minWidth: 22, textAlign: 'center' }}>
        {value}
      </T>
      {btn('+', 1, 'More calls')}
    </Row>
  );
}

export default function Me() {
  const { c, mode, setMode } = useTheme();
  const { settings, updateSettings, isLiveMode, profile, signOut } = useStore();
  const canSetGoal = settings.role === 'owner' || settings.role === 'admin' || settings.role === 'solo';
  const setNudge = (k: keyof Settings['nudges'], v: boolean) => updateSettings({ nudges: { ...settings.nudges, [k]: v } });
  const toggleStage = (s: string) => {
    const has = settings.rules.hotStages.includes(s);
    updateSettings({ rules: { ...settings.rules, hotStages: has ? settings.rules.hotStages.filter((x) => x !== s) : [...settings.rules.hotStages, s] } });
  };

  return (
    <Screen title="Me">
      <List>
        <ListRow
          left={<Avatar initials={settings.initials} size={44} />}
          label={profile?.name ?? `${settings.name} Giordano`}
          sub={`${settings.role === 'owner' || settings.role === 'admin' ? 'Team leader' : settings.role === 'solo' ? 'Solo agent' : 'Agent'}${profile?.teamName ? ` · ${profile.teamName}` : ' · Pro plan'}`}
        />
      </List>

      {settings.role === 'owner' || settings.role === 'admin' ? (
        <List>
          <ListRow label="Team admin" sub="Where your team's leads are, and who's going stale" onPress={() => router.push('/admin')} />
        </List>
      ) : null}

      {settings.role === 'solo' ? (
        <Card tint={c.soft}>
          <T w="heavy" size={17}>
            Running a team?
          </T>
          <T size={14} tone="body">
            Invite your agents. You get a Team admin view that shows where their leads are, catches hot leads nobody touched, and lets you reassign them in one tap.
          </T>
          <Pill label="Invite agents" size="sm" />
        </Card>
      ) : null}

      <Section title="Connected CRM" note="Your team connects once; agents' leads are matched by who they're assigned to.">
        {isLiveMode
          ? (['lofty', 'followupboss'] as const).map((k) =>
              profile?.crm?.kind === k ? (
                <ListRow
                  key={k}
                  label={CRM_NAME[k]}
                  value={profile.crm.status === 'active' ? 'Connected' : 'Reconnect'}
                  valueTone={profile.crm.status === 'active' ? c.good : c.accentText}
                  sub={profile.crm.lastSyncedAt ? `Synced ${relTime(profile.crm.lastSyncedAt)}` : undefined}
                  onPress={() => router.push('/connect')}
                />
              ) : !profile?.crm ? (
                <ListRow key={k} label={CRM_NAME[k]} value="Connect" valueTone={c.accentText} onPress={() => router.push('/connect')} />
              ) : null,
            )
          : (['lofty', 'followupboss', 'gohighlevel'] as const).map((k) =>
              settings.crm === k ? (
                <ListRow key={k} label={CRM_NAME[k]} value="Connected" valueTone={c.good} sub="Synced 2 min ago" />
              ) : (
                <ListRow key={k} label={CRM_NAME[k]} value="Connect" valueTone={c.accentText} onPress={() => updateSettings({ crm: k })} />
              ),
            )}
      </Section>

      <Section plain title="What counts as hot" note={`Hot leads untouched for ${settings.rules.goingColdDays} days are flagged "Slipping away" for everyone. Today shows about ${settings.rules.cap} leads.`}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {STAGES.map((s) => (
            <Chip key={s} label={s} on={settings.rules.hotStages.includes(s)} onPress={() => toggleStage(s)} />
          ))}
        </View>
      </Section>

      <Section title="Daily goal" note={canSetGoal ? (settings.role === 'solo' ? 'You set your own goal.' : 'As team leader, this sets the goal for your whole team.') : 'Set by your team leader.'}>
        <ListRow label="Calls a day" right={<Stepper value={settings.dailyGoal} disabled={!canSetGoal} onChange={(v) => updateSettings({ dailyGoal: v })} />} />
      </Section>

      <Section title="Nudges" note={`Quiet hours 9 PM – 8 AM. Max ~6 a day. Morning list at ${settings.morningListAt}.`}>
        <Toggle label="Morning list" value={settings.nudges.morning} onChange={(v) => setNudge('morning', v)} />
        <Toggle label="New lead alerts" value={settings.nudges.new_lead} onChange={(v) => setNudge('new_lead', v)} />
        <Toggle label="Promises due" value={settings.nudges.promise} onChange={(v) => setNudge('promise', v)} />
        <Toggle label="Going cold" value={settings.nudges.cold} onChange={(v) => setNudge('cold', v)} />
        <Toggle label="CRM activity" value={settings.nudges.crm} onChange={(v) => setNudge('crm', v)} />
        <Toggle label="Streak at risk" value={settings.nudges.streak} onChange={(v) => setNudge('streak', v)} />
      </Section>

      <Section title="AI" note="Messages wait for your approval unless you choose “Send for me” in Nurture.">
        <Toggle label="Learn my writing voice" sub="From your past sent texts" value={settings.voiceProfile} onChange={(v) => updateSettings({ voiceProfile: v })} />
        <ListRow label="Nurture" sub="Keep in touch with everyone not on Today" onPress={() => router.push('/nurture')} />
      </Section>

      <Section plain title="Appearance">
        <Segmented<ThemeMode> options={[{ key: 'system', label: 'Automatic' }, { key: 'light', label: 'Light' }, { key: 'dark', label: 'Dark' }]} value={mode} onChange={setMode} />
      </Section>

      {isLiveMode ? (
        <List>
          <ListRow label="Sign out" valueTone={c.accentText} onPress={signOut} />
        </List>
      ) : (
        <Section plain title="Demo">
        <Segmented
          options={[{ key: 'owner', label: 'Leader' }, { key: 'agent', label: 'Agent' }, { key: 'solo', label: 'Solo' }]}
          value={settings.role === 'admin' ? 'owner' : settings.role}
          onChange={(r) => updateSettings({ role: r })}
        />
        <List style={{ marginTop: 8 }}>
          <ListRow label="Replay onboarding" onPress={() => router.push('/onboarding')} />
          {live.isLive ? <ListRow label="Sign in to your account" valueTone={c.accentText} onPress={() => router.replace('/sign-in')} /> : null}
        </List>
      </Section>
      )}
    </Screen>
  );
}
