// Text / email composer. Decision: send through the CRM's own texting so it
// comes from the agent's CRM number and logs automatically. If the CRM can't
// send (Follow Up Boss API), open the phone's Messages and log it instead.
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { TextInput, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { Card, IconButton, Pill, Row, Screen, T, NavBar } from '@/components/ui';
import { useStore } from '@/data/store';
import { CRM_CAN_SEND, SOURCE_NAME } from '@/lib/crm';
import { openOnPhone } from '@/lib/phone';
import { useTheme } from '@/theme/ThemeProvider';
import { font } from '@/theme/tokens';

function draftFor(first: string, me: string, opener?: string) {
  return opener ? `Hi ${first}! ${opener}` : `Hi ${first}, it's ${me}. Do you have a few minutes today to catch up?`;
}

export default function Compose() {
  const { id, channel = 'text', body: preset } = useLocalSearchParams<{ id: string; channel?: 'text' | 'email'; body?: string }>();
  const { c } = useTheme();
  const { lead: get, sendMessage, settings, canSendCrm } = useStore();
  const lead = get(id);
  const [body, setBody] = useState(preset ?? (lead ? draftFor(lead.firstName, settings.name, lead.aiOpener) : ''));
  const [subject, setSubject] = useState(lead ? `Following up, ${lead.firstName}` : '');
  const [sent, setSent] = useState(false);
  if (!lead) return null;
  // Through the CRM a text goes out from the key owner's number, so only with your own key.
  const crmCan = CRM_CAN_SEND[lead.crm];
  const viaCrm = crmCan && canSendCrm;

  const send = async () => {
    if (!viaCrm) {
      await openOnPhone(channel, channel === 'email' ? lead.email : lead.phone, body, subject);
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
        {lead.crm === 'manual' ? 'Drafted from your notes. Edit anything.' : `Drafted from your ${SOURCE_NAME[lead.crm]} notes. Edit anything.`}
      </T>
      <Card>
        {channel === 'email' ? <TextInput value={subject} onChangeText={setSubject} accessibilityLabel="Subject" style={input} /> : null}
        <TextInput value={body} onChangeText={setBody} multiline accessibilityLabel="Message" style={[input, { minHeight: 140, textAlignVertical: 'top' }]} />
        <T size={12} tone="sub">
          {body.length} characters
        </T>
      </Card>
      <Pill
        label={sent ? 'Sent' : viaCrm ? `Send via ${SOURCE_NAME[lead.crm]}` : `Open ${channel === 'email' ? 'Mail' : 'Messages'} + log it`}
        icon="send"
        size="lg"
        disabled={!body.trim() || sent}
        onPress={send}
      />
      <T size={13} tone="sub" style={{ textAlign: 'center' }}>
        {viaCrm ? `Sends from your ${SOURCE_NAME[lead.crm]} number and logs it there.` : lead.crm === 'manual' ? 'We open your phone and log it to the lead.' : crmCan ? `We open your phone and log it to ${SOURCE_NAME[lead.crm]}. To send from your ${SOURCE_NAME[lead.crm]} number, go to Me → Text from my number.` : `${SOURCE_NAME[lead.crm]} can't send messages from other apps, so we open your phone and log it to the lead.`}
      </T>
    </Screen>
  );
}
