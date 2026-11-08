// Add a lead by hand — for agents without a CRM, or who'd rather not connect one.
// Slim bottom sheet, same look as the commission sheet: name, phone, email, stage, note.
// Hand-added leads live in Back 40 (they don't get pushed into a CRM).
import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState, type ComponentRef, type Ref } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View, type TextInputProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PIPELINE } from '@back40/core';

import { Chip, Pill, Row, T } from '@/components/ui';
import { useStore } from '@/data/store';
import { tap } from '@/lib/actions';
import { useTheme } from '@/theme/ThemeProvider';
import { font } from '@/theme/tokens';

/** (909) 555-0142 as they type. */
const phoneText = (s: string) => {
  const d = s.replace(/[^0-9]/g, '').replace(/^1(?=\d{10})/, '').slice(0, 10);
  if (d.length < 4) return d;
  if (d.length < 7) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
};

export default function NewLead() {
  const params = useLocalSearchParams<{ stage?: string }>();
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const { addLead } = useStore();
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const [stage, setStage] = useState(PIPELINE.find((b) => b.stage === params.stage)?.stage ?? PIPELINE[0]!.stage);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastRef = useRef<ComponentRef<typeof TextInput>>(null);
  const phoneRef = useRef<ComponentRef<typeof TextInput>>(null);
  const emailRef = useRef<ComponentRef<typeof TextInput>>(null);

  const canSave = first.trim().length > 0 && !busy;

  const save = async () => {
    if (!canSave) return;
    tap();
    setBusy(true);
    setError(null);
    try {
      const id = await addLead({ firstName: first, lastName: last, phone: phone.replace(/[^0-9+]/g, '') || undefined, email: email || undefined, stage, notes: note || undefined });
      router.replace(`/lead/${id}`);
    } catch (e) {
      setError((e as Error).message || 'Could not add the lead. Try again.');
      setBusy(false);
    }
  };

  // outlineWidth: 0 hides the browser's focus box on the web build.
  const input = { ...font('regular'), fontSize: 17, color: c.text, flex: 1, minWidth: 0, paddingVertical: 0, outlineWidth: 0 } as const;
  const line = { minHeight: 50, paddingHorizontal: 16 } as const;
  const sep = <View style={{ height: 1, backgroundColor: c.track, marginLeft: 16 }} />;
  const field = (props: TextInputProps & { inputRef?: Ref<ComponentRef<typeof TextInput>> }) => {
    const { inputRef, ...rest } = props;
    return <TextInput ref={inputRef} placeholderTextColor={c.sub} style={input} {...rest} />;
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <Pressable accessibilityLabel="Close" onPress={() => router.back()} style={{ flex: 1, minHeight: 60, backgroundColor: 'rgba(0,0,0,0.35)' }} />
      <View style={{ backgroundColor: c.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 10, paddingBottom: insets.bottom + 16, gap: 14, maxHeight: '92%' }}>
        <View style={{ alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: c.track }} />
        <Row style={{ paddingHorizontal: 20, justifyContent: 'space-between' }}>
          <T w="heavy" size={19}>
            Add a lead
          </T>
          <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={10}>
            <T size={16} tone="sub">
              Cancel
            </T>
          </Pressable>
        </Row>

        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 20, gap: 14 }}>
          <View style={{ backgroundColor: c.card, borderRadius: 16, overflow: 'hidden' }}>
            <Row style={line}>
              {field({ value: first, onChangeText: setFirst, placeholder: 'First name', autoFocus: true, autoCapitalize: 'words', autoComplete: 'off', returnKeyType: 'next', onSubmitEditing: () => lastRef.current?.focus(), accessibilityLabel: 'First name' })}
            </Row>
            {sep}
            <Row style={line}>
              {field({ inputRef: lastRef, value: last, onChangeText: setLast, placeholder: 'Last name', autoCapitalize: 'words', autoComplete: 'off', returnKeyType: 'next', onSubmitEditing: () => phoneRef.current?.focus(), accessibilityLabel: 'Last name' })}
            </Row>
          </View>

          <View style={{ backgroundColor: c.card, borderRadius: 16, overflow: 'hidden' }}>
            <Row style={line}>
              {field({ inputRef: phoneRef, value: phone, onChangeText: (t) => setPhone(phoneText(t)), placeholder: 'Phone', keyboardType: 'phone-pad', autoComplete: 'off', accessibilityLabel: 'Phone' })}
            </Row>
            {sep}
            <Row style={line}>
              {field({ inputRef: emailRef, value: email, onChangeText: setEmail, placeholder: 'Email', keyboardType: 'email-address', autoCapitalize: 'none', autoCorrect: false, autoComplete: 'off', accessibilityLabel: 'Email' })}
            </Row>
          </View>

          <View style={{ gap: 8 }}>
            <T w="medium" size={13} tone="sub" style={{ paddingHorizontal: 4 }}>
              Stage
            </T>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={{ marginHorizontal: -20 }} contentContainerStyle={{ gap: 6, paddingHorizontal: 20 }}>
              {PIPELINE.map((b) => (
                <Chip key={b.id} label={b.label} on={stage === b.stage} onPress={() => setStage(b.stage)} />
              ))}
            </ScrollView>
          </View>

          <View style={{ backgroundColor: c.card, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 12 }}>
            {field({ value: note, onChangeText: setNote, placeholder: 'Note (optional)', multiline: true, style: [input, { minHeight: 44, textAlignVertical: 'top' }], accessibilityLabel: 'Note' })}
          </View>

          {error ? (
            <T size={14} style={{ paddingHorizontal: 4, color: c.accentText }}>
              {error}
            </T>
          ) : null}

          <Pill label={busy ? 'Adding…' : 'Add lead'} size="lg" disabled={!canSave} onPress={save} />
          <T size={12} tone="sub" style={{ textAlign: 'center' }}>
            Saved in Back 40. It won’t be added to a CRM.
          </T>
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}
