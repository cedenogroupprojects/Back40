// Design tokens. Direction "A + C" (Nov 8): looks like a native iPhone app —
// grouped lists, thin separators, status dots, standard tab bar — with the
// density of a pro tool (filters, one-line context, time since activity).
// Brand colors (Nov 10): navy, cream, pops of burnt orange. Light = cream with navy
// text; dark = navy with cream text. Burnt orange is the accent in both.
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
  bg: '#F6F1E7', // cream
  card: '#FFFCF7',
  text: '#14213D', // navy
  sub: '#7A8194',
  body: '#34405A',
  soft: '#EDE6D8',
  track: '#E6DECF',
  sep: '#DCD3C3',
  accent: '#B5521F', // burnt orange
  onAccent: '#FFFFFF',
  accentText: '#A2481A',
  hotSoft: '#F6E3D6',
  good: '#2F8A5A',
  goodSoft: '#E2EFE5',
  cool: '#2E4A7D',
  coolSoft: '#E2E7F1',
  warm: '#C98A2E',
  nav: 'rgba(250,246,238,0.96)',
  navOnBg: 'transparent',
  navOnIcon: '#14213D',
  navOff: '#9097A6',
  dim: 'rgba(20,33,61,0.4)',
  shadow: false,
};

export const dark: Palette = {
  bg: '#0F1A2E', // navy
  card: '#172440',
  text: '#F6F1E7', // cream
  sub: '#8E98AD',
  body: '#C7CDD8',
  soft: '#1F2D4A',
  track: '#283958',
  sep: '#24324F',
  accent: '#E07A43', // burnt orange
  onAccent: '#0F1A2E',
  accentText: '#EC9161',
  hotSoft: '#3A2A22',
  good: '#6CC596',
  goodSoft: '#16302A',
  cool: '#93B2E8',
  coolSoft: '#1C2B49',
  warm: '#E3B36A',
  nav: 'rgba(15,26,46,0.96)',
  navOnBg: 'transparent',
  navOnIcon: '#E07A43',
  navOff: '#6F7A93',
  dim: 'rgba(5,10,20,0.6)',
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
