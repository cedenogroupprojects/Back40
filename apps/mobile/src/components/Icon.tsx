import Svg, { Path, Rect } from 'react-native-svg';

// Stroke icons (24-unit grid). Kept in one place so the set stays consistent.
const PATHS = {
  today: 'M5 5h14v15H5zM5 9h14M9 3v4M15 3v4',
  leads: 'M12 3c1 3 4 4.5 4 8.5a4 4 0 0 1-8 0c0-1.6.7-2.8 1.5-3.6.2 1.4 1 2.3 2 2.6-.5-2.5 0-5.3.5-7.5z',
  week: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  team: 'M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3',
  board: 'M4 4h4v16H4zM10 4h4v10h-4zM16 4h4v6h-4z',
  grip: 'M9 6h.01M9 12h.01M9 18h.01M15 6h.01M15 12h.01M15 18h.01',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  chat: 'M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.9A8 8 0 1 1 21 12z',
  mail: 'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM3 7l9 6 9-6',
  me: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  back: 'M15 18l-6-6 6-6',
  close: 'M18 6L6 18M6 6l12 12',
  phone: 'M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z',
  text: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  mic: 'M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3zM5 10a7 7 0 0 0 14 0M12 17v5',
  bolt: 'M13 2L4 14h7l-1 8 9-12h-7z',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M2 12h2M20 12h2',
  moon: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
  note: 'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6',
  pin: 'M12 17v5M5 17h14l-2-4V6a2 2 0 0 0-2-2H9a2 2 0 0 0-2 2v7z',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-3.5-3.5',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z',
  play: 'M7 4l13 8-13 8z',
  check: 'M5 12l5 5L20 7',
  plus: 'M12 5v14M5 12h14',
  chevron: 'M9 18l6-6-6-6',
  send: 'M22 2L11 13M22 2l-7 20-4-9-9-4z',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 22, color, width = 2, fill }: { name: IconName; size?: number; color: string; width?: number; fill?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" accessible={false}>
      <Path d={PATHS[name]} stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" fill={fill ?? 'none'} />
    </Svg>
  );
}

/** The Back 40 parcel mark. */
export function ParcelMark({ size = 26, line, cell }: { size?: number; line: string; cell: string }) {
  const small = size < 40;
  const inner = small ? 8 : 2;
  const outer = small ? 16 : 6;
  return (
    <Svg width={size} height={size} viewBox="0 0 160 160" accessible={false}>
      <Rect x={120} y={0} width={40} height={40} fill={cell} />
      <Path d="M40 0V160M80 0V160M120 0V160M0 40H160M0 80H160M0 120H160" stroke={line} strokeWidth={inner} />
      <Rect x={outer / 2} y={outer / 2} width={160 - outer} height={160 - outer} stroke={line} strokeWidth={outer} fill="none" />
    </Svg>
  );
}
