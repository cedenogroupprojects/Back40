// Morning briefing — a 2-minute spoken rundown of who to call and why.
// Live: natural human voice (ElevenLabs via the `voice` function). Demo: best phone voice.
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { Card, IconButton, Pill, Row, Screen, T, NavBar } from '@/components/ui';
import { useStore } from '@/data/store';
import { callLead } from '@/lib/actions';
import { briefingScript, playBriefing, type Playback } from '@/lib/voice';
import { useTheme } from '@/theme/ThemeProvider';

export default function Briefing() {
  const { c } = useTheme();
  const { today, settings } = useStore();
  const items = today.slice(0, 5);
  const [playing, setPlaying] = useState(false);
  const [at, setAt] = useState(0);

  const script = useMemo(() => briefingScript(settings.name, today), [today, settings.name]);
  const playback = useRef<Playback | null>(null);
  const stop = () => {
    playback.current?.stop();
    playback.current = null;
    setPlaying(false);
  };

  useEffect(() => () => playback.current?.stop(), []);

  const toggle = async () => {
    if (playing) return stop();
    setPlaying(true);
    const from = at >= script.length - 1 ? 0 : at;
    playback.current = await playBriefing(script, setAt, () => { setPlaying(false); setAt(script.length - 1); }, from);
  };

  const bars = Array.from({ length: 30 }, (_, i) => 14 + ((i * 37) % 40));
  const progress = Math.round((at / Math.max(1, script.length - 1)) * bars.length);

  return (
    <Screen bottomSpace={40}>
      <NavBar title="Briefing" onClose={() => { stop(); router.back(); }} closeLabel="Done" />
      <T w="bold" size={28} style={{ paddingHorizontal: 4 }}>
        Your morning
      </T>
      <T size={14} tone="sub" style={{ paddingHorizontal: 4, marginTop: -6 }}>
        About 2 minutes. Who to call and why.
      </T>
      <Card style={{ gap: 18 }}>
        <View style={{ height: 56, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          {bars.map((h, i) => (
            <View key={i} style={{ flex: 1, height: h, borderRadius: 3, backgroundColor: i <= progress && (playing || at > 0) ? c.accent : c.track }} />
          ))}
        </View>
        <Row gap={28} style={{ justifyContent: 'center' }}>
          <Pressable accessibilityRole="button" accessibilityLabel={playing ? 'Pause' : 'Play'} onPress={toggle} style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' }}>
            {playing ? (
              <Row gap={6}>
                <View style={{ width: 6, height: 24, borderRadius: 2, backgroundColor: c.onAccent }} />
                <View style={{ width: 6, height: 24, borderRadius: 2, backgroundColor: c.onAccent }} />
              </Row>
            ) : (
              <Icon name="play" size={26} color={c.onAccent} fill={c.onAccent} />
            )}
          </Pressable>
        </Row>
      </Card>
      {items.map((r, i) => (
        <Row key={r.lead.id} gap={12} style={{ alignItems: 'flex-start', opacity: at === 0 || at - 1 === i || !playing ? 1 : 0.6 }}>
          <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: i === 0 ? c.accent : c.soft, alignItems: 'center', justifyContent: 'center' }}>
            <T w="heavy" size={13} style={{ color: i === 0 ? c.onAccent : c.text }}>
              {i + 1}
            </T>
          </View>
          <View style={{ flex: 1 }}>
            <T w="heavy">
              {r.lead.firstName} {r.lead.lastName}
            </T>
            <T size={14} tone="body">
              {r.reason}
            </T>
          </View>
        </Row>
      ))}
      {items[0] ? <Pill label={`Start calling ${items[0].lead.firstName}`} kind="ink" size="lg" onPress={() => { stop(); router.back(); callLead(items[0]!.lead); }} /> : null}
    </Screen>
  );
}
