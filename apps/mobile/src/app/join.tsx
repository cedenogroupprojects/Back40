// Join a team from an invite link (/join?t=…). Works signed out: the agent sees
// whose team it is and how many of their leads are waiting, sets a password,
// and lands on Today with their own leads.
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, TextInput, View } from 'react-native';

import { ParcelMark } from '@/components/Icon';
import { List, Pill, Screen, T } from '@/components/ui';
import { useStore } from '@/data/store';
import * as live from '@/data/supabase';
import { useTheme } from '@/theme/ThemeProvider';
import { font } from '@/theme/tokens';

export default function Join() {
  const { t } = useLocalSearchParams<{ t?: string }>();
  const token = typeof t === 'string' ? t : '';
  const { c } = useTheme();
  const { reload } = useStore();
  const [info, setInfo] = useState<live.InviteInfo | null>(null);
  const [bad, setBad] = useState<string | null>(null);
  const [have, setHave] = useState(false); // already has a Back 40 login
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return setBad("This invite link isn't complete. Open it again from the text.");
    live
      .inviteInfo(token)
      .then((i) => {
        if (i.used) return setBad('This invite was already used. Sign in instead.');
        setInfo(i);
        setName(i.name ?? '');
        setEmail(i.email ?? '');
      })
      .catch((e) => setBad((e as Error).message));
  }, [token]);

  const field = (props: React.ComponentProps<typeof TextInput>) => (
    <TextInput placeholderTextColor={c.sub} autoCorrect={false} {...props} style={[font('regular'), { fontSize: 16, color: c.text, minHeight: 48, paddingHorizontal: 16 }]} />
  );

  const submit = async () => {
    setError(null);
    if (!have && !name.trim()) return setError('Add your name.');
    setBusy(true);
    try {
      if (have) await live.signInAndJoin(token, email, password);
      else await live.joinWithInvite(token, name.trim(), email, password);
      await reload();
      router.replace('/');
    } catch (e) {
      const msg = (e as Error).message;
      if (/already has an account/i.test(msg)) setHave(true);
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  const first = info?.leader.split(' ')[0] ?? '';

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: c.bg }}>
      <Screen bottomSpace={40}>
        <View style={{ alignItems: 'center', gap: 10, marginTop: 36, marginBottom: 12 }}>
          <ParcelMark size={44} line={c.text} cell={c.accent} />
          {info ? (
            <>
              <T w="bold" size={26} style={{ textAlign: 'center' }}>
                Join {info.team}
              </T>
              <T size={15} tone="sub" style={{ textAlign: 'center' }}>
                {first} invited you to Back 40.{info.leads ? ` ${info.leads} of your leads are ready.` : ''}
              </T>
            </>
          ) : (
            <T w="bold" size={26}>
              Back 40
            </T>
          )}
        </View>

        {bad ? (
          <View style={{ gap: 12 }}>
            <T size={15} tone="sub" style={{ textAlign: 'center' }}>
              {bad}
            </T>
            <Pill label="Go to sign in" kind="soft" onPress={() => router.replace('/sign-in')} />
          </View>
        ) : !info ? (
          <ActivityIndicator color={c.sub} style={{ marginTop: 24 }} />
        ) : (
          <>
            <List>
              {!have ? field({ value: name, onChangeText: setName, placeholder: 'Your name', autoCapitalize: 'words', textContentType: 'name', accessibilityLabel: 'Your name' }) : null}
              {field({ value: email, onChangeText: setEmail, placeholder: 'Email', autoCapitalize: 'none', keyboardType: 'email-address', textContentType: 'emailAddress', autoComplete: 'email', accessibilityLabel: 'Email' })}
              {field({ value: password, onChangeText: setPassword, placeholder: have ? 'Password' : 'Make a password (8+ characters)', secureTextEntry: true, textContentType: have ? 'password' : 'newPassword', autoComplete: have ? 'current-password' : 'new-password', accessibilityLabel: 'Password', onSubmitEditing: submit })}
            </List>

            {error ? (
              <T size={14} tone="accent" style={{ paddingHorizontal: 4 }}>
                {error}
              </T>
            ) : null}

            <Pill label={busy ? 'One moment…' : have ? 'Sign in and join' : 'Join the team'} size="lg" disabled={busy || !email || !password} onPress={submit} />

            <Pressable accessibilityRole="button" onPress={() => { setHave(!have); setError(null); }} style={{ alignSelf: 'center', padding: 12 }}>
              <T size={15} tone="accent">
                {have ? 'New to Back 40? Make an account' : 'Already have a Back 40 login? Sign in'}
              </T>
            </Pressable>
          </>
        )}
      </Screen>
    </KeyboardAvoidingView>
  );
}
