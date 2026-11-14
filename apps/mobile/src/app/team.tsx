// Team — leaders invite their agents straight from the CRM's user list.
// Each agent gets a one-time link; when they tap it and set a password,
// they're on the team with their own leads already loaded.
import { Redirect, router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Share, View } from 'react-native';

import { Avatar, List, ListRow, NavBar, Pill, Screen, SectionLabel, T } from '@/components/ui';
import { useStore } from '@/data/store';
import * as live from '@/data/supabase';
import { useTheme } from '@/theme/ThemeProvider';

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';

async function send(message: string, link: string): Promise<'shared' | 'copied'> {
  try {
    await Share.share(Platform.OS === 'ios' ? { message, url: link } : { message });
    return 'shared';
  } catch {
    // Desktop browsers without a share sheet: put it on the clipboard instead.
    if (typeof navigator !== 'undefined' && navigator.clipboard) await navigator.clipboard.writeText(message);
    return 'copied';
  }
}

export default function Team() {
  const { c } = useTheme();
  const { isLiveMode, settings } = useStore();
  const [people, setPeople] = useState<live.TeamPerson[] | null>(null);
  const [connected, setConnected] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!isLiveMode) return setPeople([]);
    setError(null);
    live.fetchRoster().then((r) => { setConnected(r.connected); setPeople(r.people); }).catch((e) => setError((e as Error).message));
  }, [isLiveMode]);
  useEffect(load, [load]);

  const invite = async (p: live.TeamPerson) => {
    setBusy(p.crmUserId);
    setNote(null);
    try {
      const { link, message } = await live.makeInvite(p.crmUserId);
      const how = await send(message, link);
      setNote(how === 'copied' ? `Invite for ${p.name.split(' ')[0]} copied. Paste it in a text.` : null);
      setPeople((ps) => ps?.map((x) => (x.crmUserId === p.crmUserId && x.status === 'none' ? { ...x, status: 'invited' } : x)) ?? ps);
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (settings.role === 'agent') return <Redirect href="/me" />;

  const joined = people?.filter((p) => p.status === 'joined') ?? [];
  const rest = people?.filter((p) => p.status !== 'joined') ?? [];

  return (
    <Screen>
      <NavBar back onClose={() => router.back()} />
      <View style={{ paddingHorizontal: 4, gap: 4 }}>
        <T w="bold" size={32}>
          Team
        </T>
        <T size={15} tone="sub">
          {people ? `${joined.length} of ${people.length} agents joined` : 'Your agents from your CRM'}
        </T>
      </View>

      {note ? (
        <T size={14} tone="accent" style={{ paddingHorizontal: 4 }}>
          {note}
        </T>
      ) : null}

      {error ? (
        <View style={{ gap: 10 }}>
          <T size={15} tone="sub">{error}</T>
          <Pill label="Try again" kind="soft" onPress={load} />
        </View>
      ) : !people ? (
        <ActivityIndicator color={c.sub} style={{ marginTop: 40 }} />
      ) : !connected ? (
        <View style={{ gap: 10 }}>
          <T size={15} tone="sub">Connect your CRM first. Your agents come from its user list.</T>
          <Pill label="Connect your CRM" onPress={() => router.push('/connect')} />
        </View>
      ) : people.length === 0 ? (
        <T size={15} tone="sub">Nobody else is on your CRM account yet.</T>
      ) : (
        <>
          {rest.length ? (
            <>
              <SectionLabel>Not on Back 40 yet</SectionLabel>
              <List>
                {rest.map((p) => (
                  <ListRow
                    key={p.crmUserId}
                    left={<Avatar initials={initials(p.name)} size={36} />}
                    label={p.name}
                    sub={p.status === 'invited' ? 'Invited · waiting to join' : p.email ?? undefined}
                    right={<Pill size="sm" kind={p.status === 'invited' ? 'soft' : 'primary'} label={busy === p.crmUserId ? '…' : p.status === 'invited' ? 'Resend' : 'Invite'} disabled={!!busy} onPress={() => invite(p)} />}
                  />
                ))}
              </List>
            </>
          ) : null}
          {joined.length ? (
            <>
              <SectionLabel>Joined</SectionLabel>
              <List>
                {joined.map((p) => (
                  <ListRow key={p.crmUserId} left={<Avatar initials={initials(p.name)} size={36} />} label={p.name} sub={`${p.leads} lead${p.leads === 1 ? '' : 's'}`} value="Joined" valueTone={c.good} />
                ))}
              </List>
            </>
          ) : null}
          <T size={13} tone="sub" style={{ paddingHorizontal: 4 }}>
            Each link works once and puts that agent's leads on their list. Agents can't see each other's leads.
          </T>
        </>
      )}
    </Screen>
  );
}
