// Design tokens. Direction "A + C" (Nov 8): looks like a native iPhone app —
// grouped lists, thin separators, status dots, standard tab bar — with the
// density of a pro tool (filters, one-line context, time since activity).
// Brand colors (Nov 11): Back 40's own look — raven black, powder blue, poppy red.
// Dark = raven black with a powder-blue hero card; light = pale powder blue with a
// raven-black hero card. Poppy red is only for actions and alerts (Call, Send, badges).
import { Platform } from 'react-native';

export type Palette = {
  bg: string;
  card: string;
  text: string;
  sub: string;
  body: string;
  soft: string;
  track: string;
  sep: string;
  accent: string;
  /** The big Today card and message bubbles. */
  hero: string;
  onHero: string;
  /** Small labels on the hero card ("OPEN WITH"). */
  heroAccent: string;
  onAccent: string;
  accentText: string;
  hotSoft: string;
  good: string;
  goodSoft: string;
  cool: string;
  coolSoft: string;
  warm: string;
  nav: string;
  navOnBg: string;
  navOnIcon: string;
  navOff: string;
  dim: string;
  shadow: boolean;
};

export const light: Palette = {
  bg: '#EAF5FC', // pale powder blue
  card: '#FFFFFF',
  text: '#080402', // raven black
  sub: '#5D6E7A',
  body: '#2A3138',
  soft: '#DCEDF7',
  track: '#CFE3EF',
  sep: '#C9DEEA',
  accent: '#E0091F', // poppy red
  hero: '#080402',
  onHero: '#F4F7FA',
  heroAccent: '#FF4D5E',
  onAccent: '#FFFFFF',
  accentText: '#C40719',
  hotSoft: '#FBE1E3',
  good: '#1E8A55',
  goodSoft: '#DDF1E6',
  cool: '#2C6E96',
  coolSoft: '#D6EAF6',
  warm: '#B87800', // amber, for "held" warnings
  nav: 'rgba(255,255,255,0.97)',
  navOnBg: 'transparent',
  navOnIcon: '#080402',
  navOff: '#7A8A95',
  dim: 'rgba(8,4,2,0.45)',
  shadow: false,
};

export const dark: Palette = {
  bg: '#080402', // raven black
  card: '#14100E',
  text: '#F4F7FA',
  sub: '#8C8F96',
  body: '#C9CCD1',
  soft: '#1C1816',
  track: '#2A2624',
  sep: '#2A2624',
  accent: '#E0091F', // poppy red
  hero: '#B6DFF5', // powder blue
  onHero: '#080402',
  heroAccent: '#B00718',
  onAccent: '#FFFFFF',
  accentText: '#FF4D5E',
  hotSoft: '#2E0D10',
  good: '#4FD18B',
  goodSoft: '#0F2A1C',
  cool: '#B6DFF5',
  coolSoft: '#16242C',
  warm: '#FFB020', // amber, for "held" warnings
  nav: 'rgba(8,4,2,0.97)',
  navOnBg: 'transparent',
  navOnIcon: '#B6DFF5',
  navOff: '#6B6E75',
  dim: 'rgba(0,0,0,0.65)',
  shadow: false,
};

/** Inter on Android/web; the iPhone's own font (San Francisco) on iOS. */
export const fonts = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
  heavy: 'Inter_700Bold',
} as const;

export type Weight = keyof typeof fonts;
const WEIGHTS: Record<Weight, '400' | '500' | '600' | '700'> = { regular: '400', medium: '500', semibold: '600', bold: '700', heavy: '700' };

export function font(w: Weight) {
  return Platform.OS === 'ios' ? { fontWeight: WEIGHTS[w] } : { fontFamily: fonts[w] };
}
