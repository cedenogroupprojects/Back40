// Approve drafts — the AI wrote these from CRM notes. Send, edit or skip.
// Nothing goes out without a tap (autopilot is opt-in per play).
import { router } from 'expo-router';
import { useState } from 'react';
import { TextInput, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { Avatar, Card, IconButton, Pill, Row, Screen, T, NavBar, List, ListRow, SectionLabel } from '@/components/ui';
import { initials, useStore } from '@/data/store';
import { CRM_NAME } from '@/lib/crm';
import { useTheme } from '@/theme/ThemeProvider';
import { font } from '@/theme/tokens';

const PLAY: Record<string, string> = { speed_to_lead: 'Brand new lead', no_answer: 'Didn’t answer', back40_sweep: 'Back on the market', recap: 'Follow-up', ask: 'You asked' };

export default function Approve() {
  const { c } = useTheme();
  const { drafts, lead: get, decideDraft } = useStore();
  const pending = drafts.filter((d) => d.status === 'pending');
  const total = drafts.length;
  const d = pending[0];
  const lead = d ? get(d.leadId) : undefined;
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState('');

  return (
    <Screen bottomSpace={40}>
      <NavBar title={d ? `${total - pending.length + 1} of ${total}` : 'Messages'} onClose={() => router.back()} closeLabel="Done" />
      {!d || !lead ? (
        <View style={{ gap: 12, paddingTop: 40, alignItems: 'center' }}>
          <Icon name="check" size={40} color={c.good} />
          <T w="bold" size={22}>
            All caught up
          </T>
          <T tone="body">New drafts show up here when a lead needs a message.</T>
          <Pill label="Back to Today" kind="ink" onPress={() => router.back()} />
        </View>
      ) : (
        <>
          <T w="bold" size={28} style={{ paddingHorizontal: 4 }}>
            {pending.length} to send
          </T>
          <T size={14} tone="sub" style={{ paddingHorizontal: 4, marginTop: -6 }}>
            Drafted from your CRM notes. Send, edit or skip.
          </T>
          <Card style={{ gap: 14 }}>
            <Row gap={12}>
              <Avatar initials={initials(lead)} size={40} />
              <View style={{ flex: 1 }}>
                <T w="semibold" size={16}>
                  {lead.firstName} {lead.lastName}
                </T>
                <T size={13} tone="sub">
                  {PLAY[d.play]}
                </T>
              </View>
              <T w="bold" size={12} tone="sub">
                {d.channel === 'email' ? 'Email' : 'Text'} · {CRM_NAME[lead.crm]}
              </T>
            </Row>
            {editing ? (
              <TextInput value={body} onChangeText={setBody} multiline autoFocus accessibilityLabel="Edit message" style={{ ...font('medium'), fontSize: 15, color: c.text, backgroundColor: c.soft, borderRadius: 16, padding: 14, minHeight: 120, textAlignVertical: 'top' }} />
            ) : (
              <View style={{ alignSelf: 'flex-end', maxWidth: '88%', backgroundColor: c.cool, borderRadius: 18, borderBottomRightRadius: 5, paddingHorizontal: 13, paddingVertical: 9 }}>
                {d.subject ? (
                  <T w="semibold" size={15} style={{ color: '#FFFFFF' }}>
                    {d.subject}
                  </T>
                ) : null}
                <T size={16} style={{ color: '#FFFFFF' }}>
                  {d.body}
                </T>
              </View>
            )}
            <T size={13} tone="sub">
              <T w="semibold" size={13} tone="sub">
                Why:{' '}
              </T>
              {d.why}
            </T>
            <Row>
              <Pill label="Skip" kind="soft" onPress={() => { setEditing(false); decideDraft(d.id, 'skipped'); }} style={{ flex: 1 }} />
              <Pill label={editing ? 'Done' : 'Edit'} kind="soft" onPress={() => { if (!editing) setBody(d.body); setEditing((v) => !v); }} style={{ flex: 1 }} />
              <Pill label="Send" icon="send" onPress={() => { decideDraft(d.id, 'sent', editing ? body : undefined); setEditing(false); }} style={{ flex: 2 }} />
            </Row>
          </Card>
          {pending.length > 1 ? (
            <>
              <SectionLabel>Up next</SectionLabel>
              <List>
                {pending.slice(1).map((x) => {
                  const l = get(x.leadId);
                  return l ? <ListRow key={x.id} label={`${l.firstName} ${l.lastName}`} value={PLAY[x.play]} /> : null;
                })}
              </List>
            </>
          ) : null}
        </>
      )}
    </Screen>
  );
}
