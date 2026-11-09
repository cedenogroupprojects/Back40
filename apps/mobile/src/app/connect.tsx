// Connect the CRM. The team leader pastes their CRM API key once; the server
// checks it, stores it in a vault (it never comes back to the phone), imports
// leads, and turns on live updates.
import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, TextInput, View } from 'react-native';

import type { CrmKind } from '@back40/core';

import { Icon } from '@/components/Icon';
import { List, ListRow, NavBar, Pill, Screen, SectionLabel, T } from '@/components/ui';
import { useStore } from '@/data/store';
import { connectCrm } from '@/data/supabase';
import { CRM_NAME } from '@/lib/crm';
import { useTheme } from '@/theme/ThemeProvider';
import { font } from '@/theme/tokens';

const HELP: Partial<Record<CrmKind, string>> = {
  lofty: 'In Lofty: Settings → Integrations → API Keys → Create API Key. Name it Back 40, copy it and paste it here.',
  followupboss: 'In Follow Up Boss: Admin → API → Create API key. Copy it and paste it here.',
};

export default function Connect() {
  const { c } = useTheme();
  const { status, profile, reload, signOut } = useStore();
  const [kind, setKind] = useState<CrmKind>('lofty');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ imported: number; mine: number; matchedYou: boolean; more: boolean } | null>(null);
  const firstTime = false;
  // Connecting needs an account: sign in first, then come right back here.
  const isAgent = profile?.role === 'agent';

  const connect = async () => {
    setError(null);
    setBusy(true);
    try {
      const r = await connectCrm(kind, key.trim());
      setDone({ imported: r.imported, mine: r.mine ?? 0, matchedYou: r.matchedYou ?? false, more: r.more });
      setKey('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    await reload();
    router.replace('/');
  };

  if (status === 'signed_out') return <Redirect href={{ pathname: '/sign-in', params: { next: '/connect' } }} />;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: c.bg }}>
      <Screen bottomSpace={40}>
        {firstTime ? <View style={{ height: 8 }} /> : <NavBar onClose={() => router.back()} back />}
        <View style={{ paddingHorizontal: 4, gap: 4 }}>
          <T w="bold" size={30}>
            {done ? 'You’re connected' : 'Connect your CRM'}
          </T>
          <T size={15} tone="sub">
            {done
              ? done.matchedYou
                ? `${done.mine} of the first ${done.imported} leads are assigned to you in ${CRM_NAME[kind]}, so they're on your list. Your agents' leads stay with them${done.more ? '. The rest are coming in over the next few minutes' : ''}.`
                : `${done.imported} leads found${done.more ? ', more coming in' : ''}. We couldn't tell which ones are yours in ${CRM_NAME[kind]} yet, so none were put on your list. We'll fix that from our side.`
              : 'Back 40 reads your leads and saves your calls, notes and stage changes back. Your key is stored encrypted and never leaves our server.'}
          </T>
        </View>

        {done ? (
          <Pill label="Open my list" size="lg" onPress={finish} />
        ) : isAgent ? (
          <T size={15} tone="body" style={{ paddingHorizontal: 4 }}>
            Your team leader connects the CRM once for the whole team. Ask them to sign in and connect it.
          </T>
        ) : (
          <>
            <SectionLabel>Your CRM</SectionLabel>
            <List>
              {(['lofty', 'followupboss'] as const).map((k) => (
                <ListRow key={k} label={CRM_NAME[k]} onPress={() => setKind(k)} right={kind === k ? <Icon name="check" size={18} color={c.accent} /> : <View style={{ width: 18 }} />} />
              ))}
              <ListRow label={CRM_NAME.gohighlevel} sub="Coming soon" />
            </List>

            <SectionLabel>API key</SectionLabel>
            <List>
              <TextInput
                value={key}
                onChangeText={setKey}
                placeholder={`Paste your ${CRM_NAME[kind]} API key`}
                placeholderTextColor={c.sub}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                accessibilityLabel="API key"
                style={[font('regular'), { fontSize: 16, color: c.text, minHeight: 48, paddingHorizontal: 16 }]}
              />
            </List>
            <T size={13} tone="sub" style={{ paddingHorizontal: 16 }}>
              {HELP[kind]}
            </T>

            {error ? (
              <T size={14} tone="accent" style={{ paddingHorizontal: 4 }}>
                {error}
              </T>
            ) : null}

            <Pill label={busy ? 'Connecting… this takes a few seconds' : `Connect ${CRM_NAME[kind]}`} size="lg" disabled={busy || key.trim().length < 10} onPress={connect} />
          </>
        )}

        {firstTime && !done ? (
          <Pill label="Sign out" kind="ghost" size="sm" onPress={signOut} style={{ alignSelf: 'center', marginTop: 8 }} />
        ) : null}
      </Screen>
    </KeyboardAvoidingView>
  );
}
