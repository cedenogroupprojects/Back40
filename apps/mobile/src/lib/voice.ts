// Spoken briefing.
//
// Live (Supabase configured): the script goes to the `voice` Edge Function, which
// returns natural, human-sounding audio from ElevenLabs. We play it with expo-audio.
// Demo / offline: falls back to the best voice the phone has (prefers "Enhanced"
// or "Premium" voices, which sound far less robotic than the default).
import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import * as Speech from 'expo-speech';

import type { RankedLead } from '@back40/core';

import { isLive, supabase } from '@/data/supabase';

const NUM = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const say = (n: number) => NUM[n] ?? String(n);

/** Written the way a person would say it out loud — short sentences, contractions, no robot lists. */
export function briefingScript(name: string, list: RankedLead[]): string[] {
  const hot = list.filter((r) => ['brand_new', 'hot_now', 'promised', 'slipping'].includes(r.label)).length;
  const top = list.slice(0, 5);
  const lead = (i: number) => (i === 0 ? 'First up' : i === top.length - 1 ? 'And last one' : i === 1 ? 'After that' : 'Then');
  const spoken = (s: string) =>
    s
      .replace(/(\d+) minutes ago/, (_, m) => `${say(Number(m))} minutes ago`)
      .replace(/\bHOA\b/g, 'H.O.A.')
      .replace(/Be the first to call\./, 'Nobody’s called yet, so be the first.');
  return [
    `Morning, ${name}. Here’s your day. You’ve got ${say(list.length)} people on your list${hot ? `, and ${say(hot)} of them ${hot === 1 ? 'is' : 'are'} hot` : ''}.`,
    ...top.map((r, i) => `${lead(i)}, ${r.lead.firstName} ${r.lead.lastName}. ${spoken(r.reason)}`),
    'That’s it. Knock out the first couple before ten and the rest of the day gets easy. Go get ’em.',
  ];
}

export type Playback = { stop: () => void };

let bestVoice: string | undefined | null = null;
async function pickVoice() {
  if (bestVoice !== null) return bestVoice;
  const voices = await Speech.getAvailableVoicesAsync().catch(() => []);
  const en = voices.filter((v) => v.language?.toLowerCase().startsWith('en-us') || v.language?.toLowerCase().startsWith('en_us'));
  const score = (v: Speech.Voice) =>
    (/premium/i.test(v.identifier + v.name) ? 40 : 0) +
    (v.quality === Speech.VoiceQuality.Enhanced || /enhanced|natural|neural/i.test(v.identifier + v.name) ? 30 : 0) +
    (/ava|zoe|evan|nathan|samantha|google us english|aria|jenny|guy/i.test(v.name) ? 10 : 0) -
    (/compact|eloquence|novelty|bad news|bubbles|whisper|zarvox|trinoids|albert|fred|junior|ralph/i.test(v.identifier + v.name) ? 50 : 0);
  bestVoice = en.sort((a, b) => score(b) - score(a))[0]?.identifier;
  return bestVoice;
}

/** Plays the briefing. `onLine` fires as each part starts (device voice only); `onDone` at the end. */
export async function playBriefing(lines: string[], onLine: (i: number) => void, onDone: () => void, startAt = 0): Promise<Playback> {
  if (isLive) {
    try {
      const { data, error } = await supabase().functions.invoke('voice', { body: { text: lines.join('\n\n') } });
      if (error || !data?.url) throw error ?? new Error('no audio');
      const player: AudioPlayer = createAudioPlayer({ uri: data.url as string });
      const sub = player.addListener('playbackStatusUpdate', (s) => {
        if (s.duration) onLine(Math.min(lines.length - 1, Math.floor((s.currentTime / s.duration) * lines.length)));
        if (s.didJustFinish) {
          sub.remove();
          player.remove();
          onDone();
        }
      });
      player.play();
      return { stop: () => { sub.remove(); player.pause(); player.remove(); } };
    } catch {
      // fall through to the device voice
    }
  }
  const voice = await pickVoice();
  let stopped = false;
  const speak = (i: number) => {
    if (stopped) return;
    if (i >= lines.length) return onDone();
    onLine(i);
    Speech.speak(lines[i]!, { voice, rate: 0.98, pitch: 1.0, onDone: () => { setTimeout(() => speak(i + 1), 350); } });
  };
  speak(startAt);
  return { stop: () => { stopped = true; Speech.stop(); } };
}
