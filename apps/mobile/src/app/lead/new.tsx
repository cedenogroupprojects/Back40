// New lead — for agents without a CRM, or who'd rather not connect one.
// Modeled on iPhone's "New Contact": Cancel · title · Add in the bar, a live
// monogram, grouped rows with labels on the left. Stage and commission open in
// place instead of throwing a wall of fields at you.
// Hand-added leads live in Back 40 (they aren't pushed into a CRM).
import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState, type ComponentRef, type ReactNode, type Ref } from 'react';
import { KeyboardAvoidingView, LayoutAnimation, Platform, Pressable, ScrollView, TextInput, View, type TextInputProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/Icon';
import { HAIRLINE, Row, T } from '@/components/ui';
import { money, useStore } from '@/data/store';
import { tap } from '@/lib/actions';
import { useTheme } from '@/theme/ThemeProvider';
import { font } from '@/theme/tokens';

type Input = ComponentRef<typeof TextInput>;

/** (909) 555-0142 as they type. */
const phoneText = (s: string) => {
  const d = s.replace(/[^0-9]/g, '').replace(/^1(?=\d{10})/, '').slice(0, 10);
  if (d.length < 4) return d;
  if (d.length < 7) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
};
const digits = (s: string) => Number(s.replace(/[^0-9]/g, '')) || 0;
const rateText = (s: string) => {
  const [a = '', ...rest] = s.replace(/[^0-9.]/g, '').split('.');
  return rest.length ? `${a}.${rest.join('').slice(0, 3)}` : a;
};
const ease = () => LayoutAnimation.configureNext(LayoutAnimation.create(180, 'easeInEaseOut', 'opacity'));

export default function NewLead() {
  const params = useLocalSearchParams<{ stage?: string }>();
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const { addLead, setCommission, pipeline: PIPELINE } = useStore();

  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const [stage, setStage] = useState(PIPELINE.find((b) => b.stage === params.stage) ?? PIPELINE[0]!);
  const [price, setPrice] = useState('');
  const [rate, setRate] = useState('');
  const [open, setOpen] = useState<'stage' | 'commission' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastRef = useRef<Input>(null);
  const phoneRef = useRef<Input>(null);
  const emailRef = useRef<Input>(null);
  const rateRef = useRef<Input>(null);

  const p = digits(price);
  const r = Number(rate) || 0;
  const commission = Math.round((p * r) / 100);
  const canSave = first.trim().length > 0 && !busy;
  const mono = `${first.trim()[0] ?? ''}${last.trim()[0] ?? ''}`.toUpperCase();

  const toggle = (which: 'stage' | 'commission') => {
    ease();
    setOpen((o) => (o === which ? null : which));
  };

  const save = async () => {
    if (!canSave) return;
    tap();
    setBusy(true);
    setError(null);
    try {
      const id = await addLead({ firstName: first, lastName: last, phone: phone.replace(/[^0-9+]/g, '') || undefined, email: email.trim() || undefined, stage: stage.stage, notes: note.trim() || undefined });
      if (commission > 0) setCommission(id, commission, { price: p, rate: r });
      router.replace(`/lead/${id}`);
    } catch (e) {
      setError((e as Error).message || 'Could not add the lead. Try again.');
      setBusy(false);
    }
  };

  // ─── pieces ───
  const field = (props: TextInputProps & { inputRef?: Ref<Input>; align?: 'left' | 'right' }) => {
    const { inputRef, align = 'left', style, ...rest } = props;
    return (
      <TextInput
        ref={inputRef}
        placeholderTextColor={c.sub}
        selectionColor={c.accent}
        style={[{ ...font('regular'), fontSize: 17, color: c.text, flex: 1, minWidth: 0, paddingVertical: 0, textAlign: align, outlineWidth: 0, ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null) }, style]}
        {...rest}
      />
    );
  };
  const group = (children: ReactNode) => <View style={{ backgroundColor: c.card, borderRadius: 14, overflow: 'hidden' }}>{children}</View>;
  const sep = (inset = 16) => <View style={{ height: HAIRLINE, backgroundColor: c.sep, marginLeft: inset }} />;
  const labeled = (label: string, child: ReactNode) => (
    <Row gap={0} style={{ minHeight: 48, paddingHorizontal: 16 }}>
      <T size={15} style={{ width: 84, color: c.accentText }}>
        {label}
      </T>
      {child}
    </Row>
  );
  const disclosure = (label: string, value: ReactNode, which: 'stage' | 'commission') => (
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: open === which }} onPress={() => toggle(which)} style={({ pressed }) => ({ backgroundColor: pressed ? c.soft : 'transparent' })}>
      <Row style={{ minHeight: 48, paddingHorizontal: 16, justifyContent: 'space-between' }}>
        <T size={17}>{label}</T>
        <Row gap={6}>
          {value}
          <View style={{ transform: [{ rotate: open === which ? '90deg' : '0deg' }] }}>
            <Icon name="chevron" size={15} color={c.sub} width={2.2} />
          </View>
        </Row>
      </Row>
    </Pressable>
  );

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: c.bg }}>
      {/* Bar: Cancel · New Lead · Add */}
      <Row style={{ paddingTop: Platform.OS === 'ios' ? 14 : insets.top + 10, paddingBottom: 10, paddingHorizontal: 16, justifyContent: 'space-between' }}>
        <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={10} style={{ minWidth: 64 }}>
          <T size={17} style={{ color: c.accentText }}>
            Cancel
          </T>
        </Pressable>
        <T w="semibold" size={17}>
          New Lead
        </T>
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: !canSave }} onPress={save} hitSlop={10} style={{ minWidth: 64, alignItems: 'flex-end' }}>
          <T w="semibold" size={17} style={{ color: canSave ? c.accentText : c.sub }}>
            {busy ? 'Adding…' : 'Add'}
          </T>
        </Pressable>
      </Row>

      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 32, gap: 22 }}>
        {/* Monogram fills in as you type */}
        <View style={{ alignItems: 'center', gap: 8, paddingTop: 6 }}>
          <View style={{ width: 88, height: 88, borderRadius: 44, backgroundColor: mono ? c.hotSoft : c.soft, alignItems: 'center', justifyContent: 'center' }}>
            {mono ? (
              <T w="semibold" size={34} style={{ color: c.accentText }}>
                {mono}
              </T>
            ) : (
              <Icon name="me" size={38} color={c.sub} width={1.6} />
            )}
          </View>
          <T size={13} tone="sub">
            Goes into {stage.label} on your pipeline
          </T>
        </View>

        {group(
          <>
            <View style={{ minHeight: 48, justifyContent: 'center', paddingHorizontal: 16 }}>
              {field({ value: first, onChangeText: setFirst, placeholder: 'First name', autoFocus: true, autoCapitalize: 'words', autoComplete: 'off', returnKeyType: 'next', onSubmitEditing: () => lastRef.current?.focus(), accessibilityLabel: 'First name' })}
            </View>
            {sep()}
            <View style={{ minHeight: 48, justifyContent: 'center', paddingHorizontal: 16 }}>
              {field({ inputRef: lastRef, value: last, onChangeText: setLast, placeholder: 'Last name', autoCapitalize: 'words', autoComplete: 'off', returnKeyType: 'next', onSubmitEditing: () => phoneRef.current?.focus(), accessibilityLabel: 'Last name' })}
            </View>
          </>,
        )}

        {group(
          <>
            {labeled('mobile', field({ inputRef: phoneRef, value: phone, onChangeText: (t) => setPhone(phoneText(t)), placeholder: '(909) 555-0142', keyboardType: 'phone-pad', autoComplete: 'off', returnKeyType: 'next', onSubmitEditing: () => emailRef.current?.focus(), accessibilityLabel: 'Phone' }))}
            {sep()}
            {labeled('email', field({ inputRef: emailRef, value: email, onChangeText: setEmail, placeholder: 'name@email.com', keyboardType: 'email-address', autoCapitalize: 'none', autoCorrect: false, autoComplete: 'off', accessibilityLabel: 'Email' }))}
          </>,
        )}

        {group(
          <>
            {disclosure(
              'Stage',
              <T size={17} tone="sub">
                {stage.label}
              </T>,
              'stage',
            )}
            {open === 'stage'
              ? PIPELINE.map((b) => (
                  <View key={b.id}>
                    {sep(32)}
                    <Pressable
                      accessibilityRole="radio"
                      accessibilityState={{ checked: b.id === stage.id }}
                      onPress={() => {
                        tap();
                        ease();
                        setStage(b);
                        setOpen(null);
                      }}
                      style={({ pressed }) => ({ backgroundColor: pressed ? c.soft : 'transparent' })}>
                      <Row style={{ minHeight: 44, paddingLeft: 32, paddingRight: 16, justifyContent: 'space-between' }}>
                        <T size={16} tone={b.id === stage.id ? 'text' : 'body'} w={b.id === stage.id ? 'semibold' : 'regular'}>
                          {b.label}
                        </T>
                        {b.id === stage.id ? <Icon name="check" size={17} color={c.accent} width={2.4} /> : null}
                      </Row>
                    </Pressable>
                  </View>
                ))
              : null}
            {sep()}
            {disclosure(
              'Commission',
              commission ? (
                <T w="semibold" size={17} tone="good">
                  {money(commission, false)}
                </T>
              ) : (
                <T size={17} tone="sub">
                  Optional
                </T>
              ),
              'commission',
            )}
            {open === 'commission' ? (
              <>
                {sep(32)}
                <Row gap={0} style={{ minHeight: 44, paddingLeft: 32, paddingRight: 16 }}>
                  <T size={16} tone="body" style={{ flex: 1 }}>
                    Purchase price
                  </T>
                  {field({ value: p ? `$${p.toLocaleString('en-US')}` : '', onChangeText: setPrice, placeholder: '$650,000', keyboardType: 'number-pad', autoFocus: true, align: 'right', returnKeyType: 'next', onSubmitEditing: () => rateRef.current?.focus(), accessibilityLabel: 'Purchase price', style: { maxWidth: 150, ...font('semibold') } })}
                </Row>
                {sep(32)}
                <Row gap={2} style={{ minHeight: 44, paddingLeft: 32, paddingRight: 16 }}>
                  <T size={16} tone="body" style={{ flex: 1 }}>
                    Commission
                  </T>
                  {field({ inputRef: rateRef, value: rate, onChangeText: (t) => setRate(rateText(t)), placeholder: '2.5', keyboardType: 'decimal-pad', align: 'right', accessibilityLabel: 'Commission percent', style: { maxWidth: 60, ...font('semibold') } })}
                  <T w="semibold" size={17} tone={rate ? 'text' : 'sub'}>
                    %
                  </T>
                </Row>
              </>
            ) : null}
          </>,
        )}

        {group(
          <View style={{ paddingHorizontal: 16, paddingVertical: 13 }}>
            {field({ value: note, onChangeText: setNote, placeholder: 'Notes', multiline: true, accessibilityLabel: 'Notes', style: { minHeight: 66, textAlignVertical: 'top' } })}
          </View>,
        )}

        {error ? (
          <T size={14} style={{ color: c.accentText, textAlign: 'center' }}>
            {error}
          </T>
        ) : null}

        <T size={12} tone="sub" style={{ textAlign: 'center', marginTop: -8 }}>
          Saved in Back 40 only. It won’t be added to a CRM.
        </T>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
