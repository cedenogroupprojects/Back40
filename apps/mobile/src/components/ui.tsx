// Shared building blocks. Style: native iPhone app (grouped lists, hairline
// separators, large titles) with pro-tool density. No shadows, no badges
// stacked on badges, color only where it means something.
import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type PressableProps, type StyleProp, type TextProps, type TextStyle, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/theme/ThemeProvider';
import { font, type Weight } from '@/theme/tokens';
import { Icon, type IconName } from './Icon';

export const HAIRLINE = StyleSheet.hairlineWidth;

type Tone = 'text' | 'sub' | 'body' | 'accent' | 'good' | 'cool' | 'onAccent';

/** Text in the app font. `w` picks the weight, `tone` the color role. */
export function T({ w = 'regular', size = 15, tone = 'text', style, ...rest }: TextProps & { w?: Weight; size?: number; tone?: Tone; style?: StyleProp<TextStyle> }) {
  const { c } = useTheme();
  const color = { text: c.text, sub: c.sub, body: c.body, accent: c.accentText, good: c.good, cool: c.cool, onAccent: c.onAccent }[tone];
  const tracking = size >= 28 ? -0.025 * size : size >= 20 ? -0.015 * size : size >= 15 ? -0.2 : 0;
  return <Text {...rest} style={[font(w), { fontSize: size, color, lineHeight: Math.round(size * 1.3), letterSpacing: tracking }, style]} />;
}

/**
 * A screen with an optional iOS-style large title. `kicker` sits small above
 * the title (a date), `right` sits beside it (icon buttons).
 */
export function Screen({
  children,
  title,
  kicker,
  right,
  scroll = true,
  pad = 16,
  bottomSpace = 100,
}: {
  children: ReactNode;
  title?: string;
  kicker?: string;
  right?: ReactNode;
  scroll?: boolean;
  pad?: number;
  bottomSpace?: number;
}) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const content = { paddingTop: insets.top + (title ? 8 : 10), paddingHorizontal: pad, paddingBottom: insets.bottom + bottomSpace, gap: 10 };
  const head = title ? (
    <View style={{ paddingHorizontal: 4, marginBottom: 2 }}>
      <View style={{ minHeight: 22, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <T w="medium" size={13} tone="sub">
          {kicker ?? ''}
        </T>
        <View style={{ flexDirection: 'row', gap: 6 }}>{right}</View>
      </View>
      <T w="bold" size={32} accessibilityRole="header">
        {title}
      </T>
    </View>
  ) : null;
  return scroll ? (
    <ScrollView style={{ flex: 1, backgroundColor: c.bg }} contentContainerStyle={content} keyboardShouldPersistTaps="handled">
      {head}
      {children}
    </ScrollView>
  ) : (
    <View style={[{ flex: 1, backgroundColor: c.bg }, content]}>
      {head}
      {children}
    </View>
  );
}

export function Card({ children, style, tint }: { children: ReactNode; style?: StyleProp<ViewStyle>; tint?: string }) {
  const { c } = useTheme();
  return <View style={[styles.card, { backgroundColor: tint ?? c.card }, style]}>{children}</View>;
}

/** Small gray label above a group, like iOS Settings. */
export function SectionLabel({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', paddingHorizontal: 16, marginTop: 10, marginBottom: -4 }}>
      <T w="medium" size={13} tone="sub">
        {children}
      </T>
      {right}
    </View>
  );
}

type PillKind = 'primary' | 'soft' | 'ink' | 'ghost' | 'tint';

export function Pill({ label, kind = 'primary', icon, onPress, style, size = 'md', accessibilityLabel, disabled }: { label: string; kind?: PillKind; icon?: IconName; onPress?: PressableProps['onPress']; style?: StyleProp<ViewStyle>; size?: 'sm' | 'md' | 'lg'; accessibilityLabel?: string; disabled?: boolean }) {
  const { c } = useTheme();
  const bg = { primary: c.accent, soft: c.soft, ink: c.text, ghost: 'transparent', tint: c.hotSoft }[kind];
  const fg = { primary: c.onAccent, soft: c.text, ink: c.bg, ghost: c.text, tint: c.accentText }[kind];
  const h = { sm: 34, md: 44, lg: 50 }[size];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        { minHeight: h, borderRadius: 12, backgroundColor: bg, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, opacity: disabled ? 0.4 : pressed ? 0.75 : 1 },
        kind === 'ghost' && { borderWidth: 1, borderColor: c.sep },
        style,
      ]}>
      {icon ? <Icon name={icon} size={16} color={fg} /> : null}
      <Text style={[font('semibold'), { fontSize: size === 'lg' ? 17 : size === 'sm' ? 14 : 16, color: fg, letterSpacing: -0.2 }]}>{label}</Text>
    </Pressable>
  );
}

/** Filter / choice chip. Optional count. */
export function Chip({ label, on, onPress, count }: { label: string; on: boolean; onPress?: () => void; count?: number }) {
  const { c } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      onPress={onPress}
      hitSlop={4}
      style={{ minHeight: 32, paddingHorizontal: 11, borderRadius: 8, flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: on ? c.text : c.card, borderWidth: on ? 0 : HAIRLINE, borderColor: c.sep }}>
      <Text style={[font('medium'), { fontSize: 13, color: on ? c.bg : c.text }]}>{label}</Text>
      {count !== undefined ? <Text style={[font('medium'), { fontSize: 13, color: on ? c.bg : c.sub, opacity: on ? 0.6 : 1 }]}>{count}</Text> : null}
    </Pressable>
  );
}

export function Avatar({ initials, size = 44, bg, fg }: { initials: string; size?: number; bg?: string; fg?: string }) {
  const { c } = useTheme();
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg ?? c.soft, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={[font('semibold'), { fontSize: size * 0.38, color: fg ?? c.sub }]}>{initials}</Text>
    </View>
  );
}

/** Status dot: hot (coral), promised (blue), back looking (amber), going cold (gray). */
export function Dot({ color, size = 8 }: { color: string; size?: number }) {
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />;
}

export function IconButton({ icon, label, onPress, tone = 'plain' }: { icon: IconName; label: string; onPress?: () => void; tone?: 'plain' | 'card' | 'soft' }) {
  const { c } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => ({ width: 36, height: 36, borderRadius: 18, backgroundColor: tone === 'card' ? c.card : tone === 'soft' ? c.soft : 'transparent', alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
      <Icon name={icon} size={22} color={tone === 'plain' ? c.accent : c.text} />
    </Pressable>
  );
}

/** Round call button used on list rows. */
export function CallButton({ onPress, label }: { onPress: () => void; label: string }) {
  const { c } = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={6} style={({ pressed }) => ({ width: 34, height: 34, borderRadius: 17, backgroundColor: c.hotSoft, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
      <Icon name="phone" size={16} color={c.accentText} />
    </Pressable>
  );
}

export function Row({ children, gap = 8, style }: { children: ReactNode; gap?: number; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap }, style]}>{children}</View>;
}

/** Grouped list: one rounded block, hairline separators inset from the left. */
export function List({ children, style, inset = 16 }: { children: ReactNode; style?: StyleProp<ViewStyle>; inset?: number }) {
  const { c } = useTheme();
  const items = (Array.isArray(children) ? children : [children]).flat().filter(Boolean);
  return (
    <View style={[{ backgroundColor: c.card, borderRadius: 12, overflow: 'hidden' }, style]}>
      {items.map((child, i) => (
        <View key={i}>
          {i ? <View style={{ height: HAIRLINE, backgroundColor: c.sep, marginLeft: inset }} /> : null}
          {child}
        </View>
      ))}
    </View>
  );
}

export function ListRow({ label, value, valueTone, onPress, right, sub, left }: { label: string; value?: ReactNode; valueTone?: string; onPress?: () => void; right?: ReactNode; sub?: string; left?: ReactNode }) {
  const { c } = useTheme();
  const body = (
    <View style={{ minHeight: 46, paddingHorizontal: 16, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      {left}
      <View style={{ flex: 1 }}>
        <T size={16}>{label}</T>
        {sub ? (
          <T size={13} tone="sub">
            {sub}
          </T>
        ) : null}
      </View>
      {value !== undefined ? (
        <T size={16} style={{ color: valueTone ?? c.sub }}>
          {value}
        </T>
      ) : null}
      {right}
      {onPress ? <Icon name="chevron" size={15} color={c.sub} width={2.2} /> : null}
    </View>
  );
  return onPress ? (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => ({ backgroundColor: pressed ? c.soft : 'transparent' })}>
      {body}
    </Pressable>
  ) : (
    body
  );
}

/** iOS-style segmented control. */
export function Segmented<K extends string>({ options, value, onChange }: { options: { key: K; label: string }[]; value: K; onChange: (k: K) => void }) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: 'row', backgroundColor: c.soft, borderRadius: 9, padding: 2 }}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Pressable
            key={o.key}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.key)}
            style={{ flex: 1, minHeight: 32, borderRadius: 7, backgroundColor: on ? c.card : 'transparent', alignItems: 'center', justifyContent: 'center', boxShadow: on ? '0 1px 2px rgba(0,0,0,0.12)' : undefined }}>
            <Text style={[font(on ? 'semibold' : 'medium'), { fontSize: 13, color: on ? c.text : c.sub }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Top bar for modal screens: "Cancel"/"Done" on the left, centered title, optional action on the right. */
export function NavBar({ title, onClose, closeLabel = 'Cancel', right, back }: { title?: string; onClose: () => void; closeLabel?: string; right?: ReactNode; back?: boolean }) {
  const { c } = useTheme();
  return (
    <View style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', marginHorizontal: -4 }}>
      <View style={{ flex: 1, alignItems: 'flex-start' }}>
        <Pressable accessibilityRole="button" accessibilityLabel={back ? 'Back' : closeLabel} onPress={onClose} hitSlop={10} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 36 }}>
          {back ? <Icon name="back" size={22} color={c.accent} width={2.2} /> : null}
          <Text style={[font('regular'), { fontSize: 17, color: c.accent }]}>{back ? 'Back' : closeLabel}</Text>
        </Pressable>
      </View>
      {title ? <Text style={[font('semibold'), { fontSize: 17, color: c.text, letterSpacing: -0.3 }]}>{title}</Text> : null}
      <View style={{ flex: 1, alignItems: 'flex-end' }}>{right}</View>
    </View>
  );
}

export function Divider() {
  const { c } = useTheme();
  return <View style={{ height: HAIRLINE, backgroundColor: c.sep }} />;
}

const styles = StyleSheet.create({
  card: { borderRadius: 12, padding: 14, gap: 8 },
});
