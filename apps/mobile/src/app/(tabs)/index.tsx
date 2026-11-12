// Today — the card stack (Nov 11). One big card per lead, the reason to call in
// large type, swipe left/right to move through the day's 10. Past the last card:
// "Your 10 are done" with stats, "Give me 5 more" and the follow-ups to approve.
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Image, PanResponder, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BADGE_TEXT, type HomeCard, type Lead, type RankedLead } from '@back40/core';

import { Icon } from '@/components/Icon';
import { T } from '@/components/ui';
import { money, useStore } from '@/data/store';
import { callLead, tap, textLead } from '@/lib/actions';
import { since, STATUS_TEXT } from '@/lib/status';
import { useTheme } from '@/theme/ThemeProvider';
import { TAB_BAR_HEIGHT } from './_layout';

const SWIPE = 70; // px to count as a swipe

function wants(l: Lead) {
  const f = l.fields;
  return [f.areas?.slice(0, 2).join(' / '), f.budgetMax ? `up to ${money(f.budgetMax)}` : null, f.bedsMin ? `${f.bedsMin}+ bd` : null].filter(Boolean).join(' · ');
}

function contactedToday(l: Lead) {
  return !!l.lastContactAt && new Date(l.lastContactAt).toDateString() === new Date().toDateString();
}

export default function Today() {
  const { c, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { today, leads, drafts, streak, callsToday, isLiveMode, status, profile, moreToday, dealsFor } = useStore();
  const needsCrm = isLiveMode && status === 'ready' && !profile?.crm;

  // Add, never take: the deck holds still while you work it. Once the day has
  // started, anyone new (a fresh lead, someone who replied or opened a home)
  // becomes your very next card and the count grows; nobody gets bumped.
  const [deckIds, setDeckIds] = useState<string[]>([]);
  const [i, setI] = useState(0);
  const iRef = useRef(0);
  iRef.current = i;
  useEffect(() => {
    setDeckIds((ids) => {
      const add = today.map((r) => r.lead.id).filter((id) => !ids.includes(id));
      if (!add.length) return ids;
      if (!ids.length) return add;
      const at = Math.min(ids.length, iRef.current + 1);
      return [...ids.slice(0, at), ...add, ...ids.slice(at)];
    });
  }, [today]);
  const byId = useMemo(() => new Map(today.map((r) => [r.lead.id, r])), [today]);
  const leadById = useMemo(() => new Map(leads.map((l) => [l.id, l])), [leads]);
  const deck: RankedLead[] = deckIds
    .map((id) => byId.get(id) ?? (leadById.get(id) ? ({ lead: leadById.get(id)!, label: 'working', heat: 0, reason: 'Worked today.' } as RankedLead) : null))
    .filter((x): x is RankedLead => !!x);

  const total = deck.length;
  const done = total > 0 && i >= total;
  const cur = deck[Math.min(i, Math.max(0, total - 1))];
  const pending = drafts.filter((d) => d.status === 'pending');
  const pendingHomes = pending.filter((d) => d.home?.badge === 'coming_soon').length;
  const worked = deck.filter((r) => contactedToday(r.lead)).length;

  // Swipe
  const x = useRef(new Animated.Value(0)).current;
  const go = (d: number) => {
    tap();
    setI((n) => Math.max(0, Math.min(total, n + d)));
  };
  const goRef = useRef(go);
  goRef.current = go;
  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy),
        onPanResponderMove: (_, g) => x.setValue(g.dx),
        onPanResponderRelease: (_, g) => {
          if (Math.abs(g.dx) > SWIPE) {
            const dir = g.dx < 0 ? 1 : -1;
            Animated.timing(x, { toValue: g.dx < 0 ? -420 : 420, duration: 160, useNativeDriver: true }).start(() => {
              goRef.current(dir);
              x.setValue(0);
            });
          } else Animated.spring(x, { toValue: 0, useNativeDriver: true, bounciness: 6 }).start();
        },
        onPanResponderTerminate: () => Animated.spring(x, { toValue: 0, useNativeDriver: true }).start(),
      }),
    [x],
  );
  const rotate = x.interpolate({ inputRange: [-300, 0, 300], outputRange: ['-6deg', '0deg', '6deg'] });

  const ink = c.hero; // powder blue on black, black on pale blue
  const onInk = c.onHero;
  const veil = isDark ? 'rgba(8,4,2,0.07)' : 'rgba(182,223,245,0.10)';
  const subInk = { color: onInk, opacity: 0.68 };

  const first = cur?.lead.firstName || 'them';
  const headline = needsCrm ? 'Connect your CRM' : done ? 'All caught up' : !total ? 'Nobody to call' : `Call ${first}${i === 0 ? ' first' : ''}`;
  const home: HomeCard | undefined = cur ? dealsFor(cur.lead.id)[0] : undefined;

  return (
    <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top + 14, paddingBottom: TAB_BAR_HEIGHT + Math.max(insets.bottom, 6) + 12 }}>
      {/* Header */}
      <View style={{ paddingHorizontal: 22, gap: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ gap: 2, flex: 1 }}>
            <T w="semibold" size={12} tone="sub" style={{ letterSpacing: 0.4 }}>
              {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }).toUpperCase()}
              {streak ? ` · ${streak}-DAY STREAK` : ''}
            </T>
            <T w="heavy" size={30} numberOfLines={1} accessibilityRole="header">
              {headline}
            </T>
          </View>
          {total ? (
            <View style={{ width: 54, height: 54, borderRadius: 27, backgroundColor: ink, alignItems: 'center', justifyContent: 'center' }}>
              <T w="heavy" size={16} style={{ color: onInk }}>
                {done ? total : i + 1}/{total}
              </T>
            </View>
          ) : null}
        </View>
        {total ? (
          <View style={{ flexDirection: 'row', gap: 4 }} accessibilityLabel={`${Math.min(i, total)} of ${total} done`}>
            {deck.map((r, k) => (
              <View key={r.lead.id} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: k === i ? c.accent : k < i || contactedToday(r.lead) ? ink : c.sep }} />
            ))}
          </View>
        ) : null}
      </View>

      {needsCrm ? (
        <View style={{ flex: 1, margin: 16, marginTop: 18, borderRadius: 28, backgroundColor: ink, padding: 24, gap: 14, justifyContent: 'center' }}>
          <T w="heavy" size={28} style={{ color: onInk }}>
            Bring in your leads
          </T>
          <T size={17} style={subInk}>
            Connect Lofty or Follow Up Boss and Back 40 picks the 10 people worth calling every morning.
          </T>
          <BigButton label="Connect your CRM" onPress={() => router.push('/connect')} />
        </View>
      ) : done ? (
        <View style={{ flex: 1, marginHorizontal: 16, marginTop: 18, gap: 12 }}>
          <View style={{ backgroundColor: ink, borderRadius: 28, padding: 24, gap: 14 }}>
            <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="check" size={26} color="#FFFFFF" width={2.8} />
            </View>
            <T w="heavy" size={30} style={{ color: onInk }}>
              Your {total} are done.
            </T>
            <T size={16} style={subInk}>
              Anyone who answers, texts back or opens a home moves to the top of tomorrow’s list.
            </T>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Stat n={callsToday} label="calls" ink={onInk} veil={veil} />
              <Stat n={worked} label="reached out" ink={onInk} veil={veil} />
              <Stat n={streak} label="day streak" ink={onInk} veil={veil} accent={c.accent} />
            </View>
          </View>
          <BigButton label="Give me 5 more" onPress={() => { moreToday(); }} />
          {pending.length ? (
            <Pressable accessibilityRole="button" onPress={() => router.push('/approve')} style={({ pressed }) => ({ minHeight: 60, borderRadius: 20, borderWidth: 1, borderColor: c.sep, backgroundColor: c.card, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', opacity: pressed ? 0.7 : 1 })}>
              <T w="bold" size={16}>
                {pending.length} follow-ups to approve
              </T>
              <T w="semibold" size={14} tone="accent">
                {pendingHomes ? `${pendingHomes} coming soon` : 'Review'}
              </T>
            </Pressable>
          ) : null}
          <Pressable accessibilityRole="button" onPress={() => setI(0)} style={{ minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
            <T w="semibold" size={14} tone="sub">
              Back to today’s list
            </T>
          </Pressable>
        </View>
      ) : !cur ? (
        <View style={{ flex: 1, margin: 16, marginTop: 18, borderRadius: 28, backgroundColor: c.card, padding: 24, gap: 10, justifyContent: 'center' }}>
          <T w="heavy" size={24}>
            Nobody needs a call right now
          </T>
          <T size={16} tone="body">
            New leads and hot activity from your CRM show up here within a minute.
          </T>
        </View>
      ) : (
        <View style={{ flex: 1, marginHorizontal: 16, marginTop: 18 }}>
          {/* The stack behind */}
          {total - i > 2 ? <View style={{ position: 'absolute', left: 18, right: 18, top: 22, bottom: 96, borderRadius: 28, backgroundColor: c.sep }} /> : null}
          {total - i > 1 ? <View style={{ position: 'absolute', left: 9, right: 9, top: 11, bottom: 108, borderRadius: 28, backgroundColor: isDark ? '#5E7889' : '#5A5654' }} /> : null}

          <Animated.View {...pan.panHandlers} style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 120, transform: [{ translateX: x }, { rotate }] }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${cur.lead.firstName} ${cur.lead.lastName}. ${cur.reason}`}
              accessibilityHint="Opens the lead. Swipe left or right for the next lead."
              onPress={() => router.push(`/lead/${cur.lead.id}`)}
              style={{ flex: 1, borderRadius: 28, backgroundColor: ink, padding: 22, gap: 14, overflow: 'hidden' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <View style={{ backgroundColor: contactedToday(cur.lead) ? c.good : c.accent, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 }}>
                  <T w="bold" size={12} style={{ color: '#FFFFFF', letterSpacing: 0.6 }}>
                    {contactedToday(cur.lead) ? 'DONE TODAY' : `${STATUS_TEXT[cur.label].toUpperCase()}${since(cur.lead) ? ` · ${since(cur.lead).toUpperCase()}` : ''}`}
                  </T>
                </View>
                <T size={13} numberOfLines={1} style={[subInk, { flexShrink: 1 }]}>
                  {cur.lead.source ?? cur.lead.stage}
                </T>
              </View>
              <View style={{ gap: 4 }}>
                <T w="heavy" size={36} numberOfLines={2} style={{ color: onInk, lineHeight: 39 }}>
                  {cur.lead.firstName} {cur.lead.lastName}
                </T>
                {wants(cur.lead) ? (
                  <T size={15} style={subInk}>
                    {wants(cur.lead)}
                  </T>
                ) : null}
              </View>
              <T w="semibold" size={20} numberOfLines={4} style={{ color: onInk, lineHeight: 27 }}>
                {cur.reason}
              </T>
              {cur.lead.aiOpener ? (
                <View style={{ backgroundColor: veil, borderRadius: 16, padding: 14, gap: 4 }}>
                  <T w="bold" size={11} style={{ color: c.heroAccent, letterSpacing: 0.8 }}>
                    OPEN WITH
                  </T>
                  <T size={15} numberOfLines={3} style={{ color: onInk, opacity: 0.9 }}>
                    “{cur.lead.aiOpener}”
                  </T>
                </View>
              ) : null}
              <View style={{ marginTop: 'auto', flexDirection: 'row', gap: 8 }}>
                <Fact label="CONTACTED" value={cur.lead.lastContactAt ? since(cur.lead) || 'today' : 'Never'} ink={onInk} veil={veil} />
                <Fact label="STAGE" value={cur.lead.stage} ink={onInk} veil={veil} />
                <Fact label="IF IT CLOSES" value={cur.lead.fields.potentialCommission ? money(cur.lead.fields.potentialCommission) : '—'} ink={onInk} veil={veil} />
              </View>
              {home ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: c.bg, borderRadius: 16, padding: 10 }}>
                  {home.photo ? (
                    <Image source={{ uri: home.photo }} style={{ width: 58, height: 58, borderRadius: 12, backgroundColor: c.track }} accessibilityIgnoresInvertColors />
                  ) : (
                    <View style={{ width: 58, height: 58, borderRadius: 12, backgroundColor: c.track }} />
                  )}
                  <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
                    <T w="bold" size={11} tone="accent" style={{ letterSpacing: 0.6 }}>
                      {home.badge ? BADGE_TEXT[home.badge].toUpperCase() : 'FITS THEM'}
                    </T>
                    <T w="bold" size={15} numberOfLines={1}>
                      {home.title}
                    </T>
                    <T size={13} tone="sub" numberOfLines={1}>
                      {[home.price ? money(home.price, false) : null, home.beds ? `${home.beds} bd` : null, home.baths ? `${home.baths} ba` : null].filter(Boolean).join(' · ')}
                    </T>
                  </View>
                </View>
              ) : null}
            </Pressable>
          </Animated.View>

          <T w="semibold" size={12} tone="sub" style={{ position: 'absolute', left: 0, right: 0, bottom: 84, textAlign: 'center' }}>
            Swipe for the next lead · tap the card for details
          </T>
          <View style={{ position: 'absolute', left: 0, right: 0, bottom: 4, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
            <RoundButton icon="back" label="Previous lead" onPress={() => go(-1)} disabled={i === 0} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Call ${cur.lead.firstName}`}
              onPress={() => callLead(cur.lead)}
              style={({ pressed }) => ({ height: 60, flex: 1, maxWidth: 210, borderRadius: 30, backgroundColor: c.accent, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, opacity: pressed ? 0.85 : 1 })}>
              <Icon name="phone" size={20} color="#FFFFFF" />
              <T w="bold" size={17} numberOfLines={1} style={{ color: '#FFFFFF', flexShrink: 1 }}>
                Call {cur.lead.firstName || 'now'}
              </T>
            </Pressable>
            <RoundButton icon="text" label={`Text ${cur.lead.firstName}`} onPress={() => textLead(cur.lead)} solid />
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Next lead" onPress={() => go(1)} style={{ position: 'absolute', right: -4, top: '42%', width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
            <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center', opacity: 0.9 }}>
              <Icon name="chevron" size={16} color={c.text} width={2.6} />
            </View>
          </Pressable>
        </View>
      )}
    </View>
  );
}

function BigButton({ label, onPress }: { label: string; onPress: () => void }) {
  const { c } = useTheme();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => ({ height: 60, borderRadius: 20, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.85 : 1 })}>
      <T w="bold" size={17} style={{ color: '#FFFFFF' }}>
        {label}
      </T>
    </Pressable>
  );
}

function RoundButton({ icon, label, onPress, solid, disabled }: { icon: 'back' | 'text'; label: string; onPress: () => void; solid?: boolean; disabled?: boolean }) {
  const { c } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({ width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', backgroundColor: solid ? c.hero : c.card, borderWidth: solid ? 0 : 1.5, borderColor: c.sep, opacity: disabled ? 0.35 : pressed ? 0.7 : 1 })}>
      <Icon name={icon} size={22} color={solid ? c.onHero : c.text} width={2.2} />
    </Pressable>
  );
}

function Fact({ label, value, ink, veil }: { label: string; value: string; ink: string; veil: string }) {
  return (
    <View style={{ flex: 1, minWidth: 0, backgroundColor: veil, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 8, gap: 1 }}>
      <T w="bold" size={10} style={{ color: ink, opacity: 0.6, letterSpacing: 0.6 }}>
        {label}
      </T>
      <T w="bold" size={14} numberOfLines={1} style={{ color: ink }}>
        {value}
      </T>
    </View>
  );
}

function Stat({ n, label, ink, veil, accent }: { n: number; label: string; ink: string; veil: string; accent?: string }) {
  return (
    <View style={{ flex: 1, backgroundColor: veil, borderRadius: 14, padding: 10 }}>
      <T w="heavy" size={22} style={{ color: accent ?? ink }}>
        {n}
      </T>
      <T size={12} style={{ color: ink, opacity: 0.68 }}>
        {label}
      </T>
    </View>
  );
}
