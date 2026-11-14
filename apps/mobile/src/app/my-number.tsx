// Text from my number — an agent on a team adds their OWN Lofty key so texts
// they send from Back 40 go out from their Lofty number, never the team leader's.
// Leads still come in through the team's connection; this key is only for sending.
import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, TextInput, View } from 'react-native';

import { Card, List, NavBar, Pill, Screen, SectionLabel, T } from '@/components/ui';
import { useStore } from '@/data/store';
import * as live from '@/data/supabase';
import { useTheme } from '@/theme/ThemeProvider';
import { font } from '@/theme/tokens';

export default function MyNumber() {
  const { c } = useTheme();
  const { canSendCrm, refreshCanSend } = useStore();
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const save = async () => {
    setError(null);
    setBusy(true);
    try {
      await live.addPersonalKey('lofty', key.trim());
      setKey('');
      setDone(true);
      refreshCanSend();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: c.bg }}>
      <Screen bottomSpace={40}>
        <NavBar back onClose={() => router.back()} />
        <View style={{ paddingHorizontal: 4, gap: 6 }}>
          <T w="bold" size={30}>
            Text from my number
          </T>
          <T size={15} tone="sub">
            {canSendCrm || done
              ? 'On. Texts you send from Back 40 go out from your own Lofty number and show up in Lofty.'
              : 'Right now Back 40 opens your phone with the text ready. Add your own Lofty key and texts go out from your Lofty number instead, logged in Lofty.'}
          </T>
        </View>

        {canSendCrm || done ? (
          <Pill label="Done" kind="soft" onPress={() => router.back()} />
        ) : (
          <>
            <Card tint={c.soft}>
              <T size={14} tone="body">
                Sign in to Lofty as you, then: Settings → Integrations → API Keys → Create API Key. Name it Back 40, copy it and paste it here.
              </T>
            </Card>
            <SectionLabel>Your Lofty API key</SectionLabel>
            <List>
              <TextInput
                value={key}
                onChangeText={setKey}
                placeholder="Paste your Lofty API key"
                placeholderTextColor={c.sub}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                accessibilityLabel="Your Lofty API key"
                style={[font('regular'), { fontSize: 16, color: c.text, minHeight: 48, paddingHorizontal: 16 }]}
              />
            </List>
            {error ? (
              <T size={14} tone="accent" style={{ paddingHorizontal: 4 }}>
                {error}
              </T>
            ) : null}
            <Pill label={busy ? 'Checking…' : 'Save'} size="lg" disabled={busy || key.trim().length < 10} onPress={save} />
            <T size={13} tone="sub" style={{ textAlign: 'center' }}>
              It has to be the key from your own Lofty login. Back 40 checks that.
            </T>
          </>
        )}
      </Screen>
    </KeyboardAvoidingView>
  );
}
