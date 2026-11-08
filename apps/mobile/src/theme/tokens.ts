// Design tokens. Direction "A + C" (Nov 8): looks like a native iPhone app —
// grouped lists, thin separators, status dots, standard tab bar — with the
// density of a pro tool (filters, one-line context, time since activity).
// Light = iOS grouped grays; dark = near-black with the toned-down Ember coral.
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
  bg: '#F2F2F7',
  card: '#FFFFFF',
  text: '#111113',
  sub: '#8A8A8E',
  body: '#3C3C43',
  soft: '#E9E9EE',
  track: '#E3E3E8',
  sep: '#D1D1D6',
  accent: '#E5533D',
  onAccent: '#FFFFFF',
  accentText: '#D9472F',
  hotSoft: '#FDECE8',
  good: '#2E9E5B',
  goodSoft: '#E6F4EC',
  cool: '#3478F6',
  coolSoft: '#E8F0FE',
  warm: '#E8A33D',
  nav: 'rgba(249,249,249,0.96)',
  navOnBg: 'transparent',
  navOnIcon: '#E5533D',
  navOff: '#8A8A8E',
  dim: 'rgba(0,0,0,0.35)',
  shadow: false,
};

export const dark: Palette = {
  bg: '#0E0F11',
  card: '#17181B',
  text: '#EDEDEF',
  sub: '#8A8F97',
  body: '#B4B8BE',
  soft: '#1F2125',
  track: '#2A2D33',
  sep: '#25272C',
  accent: '#E8734F',
  onAccent: '#0E0F11',
  accentText: '#EC8763',
  hotSoft: '#2A1A14',
  good: '#5BC08A',
  goodSoft: '#14241B',
  cool: '#7AA2F7',
  coolSoft: '#172033',
  warm: '#D9A55B',
  nav: 'rgba(14,15,17,0.96)',
  navOnBg: 'transparent',
  navOnIcon: '#EDEDEF',
  navOff: '#6B7079',
  dim: 'rgba(0,0,0,0.6)',
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
