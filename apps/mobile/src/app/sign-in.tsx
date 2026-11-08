// Sign in / create account. Accounts are created ready to use (no email
// confirmation step), so an agent can get going from their phone in a minute.
import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, TextInput, View } from 'react-native';

import { ParcelMark } from '@/components/Icon';
import { List, Pill, Screen, Segmented, T } from '@/components/ui';
import { useStore } from '@/data/store';
import { signIn, signUp } from '@/data/supabase';
import { useTheme } from '@/theme/ThemeProvider';
import { font } from '@/theme/tokens';

export default function SignIn() {
  const { c } = useTheme();
  const { enterDemo, reload } = useStore();
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [name, setName] = useState('');
  const [team, setTeam] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const field = (props: React.ComponentProps<typeof TextInput>) => (
    <TextInput placeholderTextColor={c.sub} autoCorrect={false} {...props} style={[font('regular'), { fontSize: 16, color: c.text, minHeight: 48, paddingHorizontal: 16 }]} />
  );

  const submit = async () => {
    setError(null);
    if (mode === 'up' && !name.trim()) return setError('Add your name.');
    setBusy(true);
    try {
      if (mode === 'up') await signUp(name.trim(), email, password, team.trim());
      else await signIn(email, password);
      await reload();
      router.replace('/');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: c.bg }}>
      <Screen bottomSpace={40}>
        <View style={{ alignItems: 'center', gap: 10, marginTop: 36, marginBottom: 12 }}>
          <ParcelMark size={44} line={c.text} cell={c.accent} />
          <T w="bold" size={28}>
            Back 40
          </T>
          <T size={15} tone="sub" style={{ textAlign: 'center' }}>
            The people worth calling today, from your CRM.
          </T>
        </View>

        <Segmented<'in' | 'up'> options={[{ key: 'in', label: 'Sign in' }, { key: 'up', label: 'Create account' }]} value={mode} onChange={(m) => { setMode(m); setError(null); }} />

        <List>
          {mode === 'up' ? field({ value: name, onChangeText: setName, placeholder: 'Your name', autoCapitalize: 'words', textContentType: 'name', accessibilityLabel: 'Your name' }) : null}
          {mode === 'up' ? field({ value: team, onChangeText: setTeam, placeholder: 'Team name (optional)', autoCapitalize: 'words', accessibilityLabel: 'Team name' }) : null}
          {field({ value: email, onChangeText: setEmail, placeholder: 'Email', autoCapitalize: 'none', keyboardType: 'email-address', textContentType: 'emailAddress', autoComplete: 'email', accessibilityLabel: 'Email' })}
          {field({ value: password, onChangeText: setPassword, placeholder: mode === 'up' ? 'Password (8+ characters)' : 'Password', secureTextEntry: true, textContentType: mode === 'up' ? 'newPassword' : 'password', autoComplete: mode === 'up' ? 'new-password' : 'current-password', accessibilityLabel: 'Password', onSubmitEditing: submit })}
        </List>

        {error ? (
          <T size={14} tone="accent" style={{ paddingHorizontal: 4 }}>
            {error}
          </T>
        ) : null}

        <Pill label={busy ? 'One moment…' : mode === 'up' ? 'Create account' : 'Sign in'} size="lg" disabled={busy || !email || !password} onPress={submit} />

        <Pressable accessibilityRole="button" onPress={() => { enterDemo(); router.replace('/'); }} style={{ alignSelf: 'center', padding: 12 }}>
          <T size={15} tone="accent">
            Just looking? Try it with sample leads
          </T>
        </Pressable>
      </Screen>
    </KeyboardAvoidingView>
  );
}
