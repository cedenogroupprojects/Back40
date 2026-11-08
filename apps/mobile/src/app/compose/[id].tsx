// Text / email composer. Decision: send through the CRM's own texting so it
// comes from the agent's CRM number and logs automatically. If the CRM can't
// send (Follow Up Boss API), open the phone's Messages and log it instead.
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Linking, Platform, TextInput, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { Card, IconButton, Pill, Row, Screen, T, NavBar } from '@/components/ui';
import { useStore } from '@/data/store';
import { CRM_CAN_SEND, CRM_NAME } from '@/lib/crm';
import { useTheme } from '@/theme/ThemeProvider';
import { font } from '@/theme/tokens';

function draftFor(first: string, me: string, opener?: string) {
  return opener ? `Hi ${first}! ${opener}` : `Hi ${first}, it's ${me}. Do you have a few minutes today to catch up?`;
}

export default function Compose() {
  const { id, channel = 'text', body: preset } = useLocalSearchParams<{ id: string; channel?: 'text' | 'email'; body?: string }>();
  const { c } = useTheme();
  const { lead: get, sendMessage, settings } = useStore();
  const lead = get(id);
  const [body, setBody] = useState(preset ?? (lead ? draftFor(lead.firstName, settings.name, lead.aiOpener) : ''));
  const [subject, setSubject] = useState(lead ? `Following up, ${lead.firstName}` : '');
  const [sent, setSent] = useState(false);
  if (!lead) return null;
  const viaCrm = CRM_CAN_SEND[lead.crm];

  const send = async () => {
    if (!viaCrm) {
      const url = channel === 'email' ? `mailto:${lead.email ?? ''}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}` : `sms:${lead.phone ?? ''}${Platform.OS === 'android' ? '?' : '&'}body=${encodeURIComponent(body)}`;
      if (Platform.OS === 'web') window.location.href = url;
      else await Linking.openURL(url).catch(() => undefined);
    }
    sendMessage(lead.id, channel, body, { subject: channel === 'email' ? subject : undefined, fromPhone: !viaCrm });
    setSent(true);
    setTimeout(() => router.back(), 900);
  };

  const input = { ...font('regular'), fontSize: 16, color: c.text, paddingVertical: 4 } as const;

  return (
    <Screen bottomSpace={40}>
      <NavBar title={`${channel === 'email' ? 'Email' : 'Text'} ${lead.firstName}`} onClose={() => router.back()} />
      <T size={13} tone="sub" style={{ paddingHorizontal: 4 }}>
        Drafted from your {CRM_NAME[lead.crm]} notes. Edit anything.
      </T>
      <Card>
        {channel === 'email' ? <TextInput value={subject} onChangeText={setSubject} accessibilityLabel="Subject" style={input} /> : null}
        <TextInput value={body} onChangeText={setBody} multiline accessibilityLabel="Message" style={[input, { minHeight: 140, textAlignVertical: 'top' }]} />
        <T size={12} tone="sub">
          {body.length} characters
        </T>
      </Card>
      <Pill
        label={sent ? 'Sent' : viaCrm ? `Send via ${CRM_NAME[lead.crm]}` : `Open ${channel === 'email' ? 'Mail' : 'Messages'} + log it`}
        icon="send"
        size="lg"
        disabled={!body.trim() || sent}
        onPress={send}
      />
      <T size={13} tone="sub" style={{ textAlign: 'center' }}>
        {viaCrm ? `Sends from your ${CRM_NAME[lead.crm]} number and logs it there.` : `${CRM_NAME[lead.crm]} can't send messages from other apps, so we open your phone and log it to the lead.`}
      </T>
    </Screen>
  );
}
