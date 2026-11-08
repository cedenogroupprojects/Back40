// Ask Back 40 — answers from the agent's CRM data, shows where the answer came
// from, and drafts actions that the agent confirms.
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View, type ScrollViewInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/Icon';
import { IconButton, Pill, Row, T, NavBar, HAIRLINE } from '@/components/ui';
import { answer } from '@/data/demoAi';
import { useStore } from '@/data/store';
import { useTheme } from '@/theme/ThemeProvider';
import { font } from '@/theme/tokens';

type Msg = { from: 'me' | 'ai'; text: string; source?: string; draftFor?: string };

const SUGGEST = ['Who should I call first?', 'What did Tony say about his budget?', 'How am I doing this week?'];

export default function Ask() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const { leads, sendMessage } = useStore();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState('');
  const scroll = useRef<ScrollViewInstance>(null);

  const ask = (text: string) => {
    if (!text.trim()) return;
    const lower = text.toLowerCase();
    const who = leads.find((l) => lower.includes(l.firstName.toLowerCase()));
    const reply: Msg = lower.startsWith('text ') && who
      ? { from: 'ai', text: `Here's a draft for ${who.firstName}:\n\n"Hi ${who.firstName}! ${text.replace(/^text\s+\w+\s*(that\s*)?/i, '').replace(/^./, (x) => x.toUpperCase())}"`, draftFor: who.id }
      : { from: 'ai', ...answer(text, leads) };
    setMsgs((m) => [...m, { from: 'me', text }, reply]);
    setQ('');
    setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 50);
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={{ paddingTop: insets.top + 6, paddingHorizontal: 16 }}>
        <NavBar title="Ask Back 40" onClose={() => router.back()} closeLabel="Done" />
      </View>
      <ScrollView ref={scroll} contentContainerStyle={{ padding: 16, gap: 10 }}>
        {msgs.length === 0 ? (
          <T size={14} tone="sub" style={{ textAlign: 'center', marginVertical: 8 }}>Ask about any lead, draft a text, or set a reminder. Answers come only from your CRM.</T>
        ) : null}
        {msgs.map((m, i) =>
          m.from === 'me' ? (
            <View key={i} style={{ alignSelf: 'flex-end', maxWidth: '82%', backgroundColor: c.cool, borderRadius: 18, borderBottomRightRadius: 5, paddingHorizontal: 13, paddingVertical: 9 }}>
              <T size={16} style={{ color: '#FFFFFF' }}>
                {m.text}
              </T>
            </View>
          ) : (
            <View key={i} style={{ alignSelf: 'flex-start', maxWidth: '90%', backgroundColor: c.card, borderRadius: 18, borderBottomLeftRadius: 5, paddingHorizontal: 13, paddingVertical: 10, gap: 8 }}>
              <T size={15}>{m.text}</T>
              {m.source ? (
                <View style={{ alignSelf: 'flex-start', backgroundColor: c.soft, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 }}>
                  <T w="bold" size={12} tone="sub">
                    {m.source}
                  </T>
                </View>
              ) : null}
              {m.draftFor ? (
                <Row>
                  <Pill label="Edit" kind="soft" size="sm" onPress={() => router.replace(`/compose/${m.draftFor}?body=${encodeURIComponent(m.text.split('"')[1] ?? '')}`)} style={{ flex: 1 }} />
                  <Pill label="Send" size="sm" onPress={() => { sendMessage(m.draftFor!, 'text', m.text.split('"')[1] ?? ''); setMsgs((x) => [...x, { from: 'ai', text: 'Sent and logged to your CRM.' }]); }} style={{ flex: 2 }} />
                </Row>
              ) : null}
            </View>
          ),
        )}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 4 }}>
          {SUGGEST.map((s) => (
            <Pressable key={s} accessibilityRole="button" onPress={() => ask(s)} style={{ minHeight: 34, paddingHorizontal: 12, borderRadius: 8, backgroundColor: c.card, justifyContent: 'center' }}>
              <T w="medium" size={14} tone="accent">
                {s}
              </T>
            </Pressable>
          ))}
        </View>
      </ScrollView>
      <Row gap={8} style={{ paddingHorizontal: 12, paddingTop: 8, paddingBottom: insets.bottom + 10, borderTopWidth: HAIRLINE, borderTopColor: c.sep, backgroundColor: c.nav }}>
        <TextInput
          value={q}
          onChangeText={setQ}
          onSubmitEditing={() => ask(q)}
          placeholder="Ask about any lead…"
          placeholderTextColor={c.sub}
          accessibilityLabel="Ask Back 40"
          returnKeyType="send"
          style={{ flex: 1, minHeight: 38, borderRadius: 19, borderWidth: HAIRLINE, borderColor: c.sep, backgroundColor: c.card, paddingHorizontal: 14, ...font('regular'), fontSize: 16, color: c.text }}
        />
        <Pressable accessibilityRole="button" accessibilityLabel="Send question" onPress={() => ask(q)} style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: q ? c.accent : c.soft, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={q ? 'send' : 'mic'} size={16} color={q ? c.onAccent : c.sub} />
        </Pressable>
      </Row>
    </KeyboardAvoidingView>
  );
}
