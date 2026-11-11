// Standard bottom tab bar: icon + label, thin line on top, like any iPhone app.
// Built on Expo Router's headless tabs so it looks the same on iPhone, Android and web.
import { Redirect } from 'expo-router';
import { TabList, TabSlot, TabTrigger, Tabs, type TabTriggerSlotProps } from 'expo-router/ui';
import { forwardRef, type ComponentRef } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, type IconName } from '@/components/Icon';
import { HAIRLINE } from '@/components/ui';
import { useStore } from '@/data/store';
import { useTheme } from '@/theme/ThemeProvider';
import { font } from '@/theme/tokens';

export const TAB_BAR_HEIGHT = 50;

const TabButton = forwardRef<ComponentRef<typeof Pressable>, TabTriggerSlotProps & { icon: IconName; label: string; badge?: number }>(function TabButton({ isFocused, icon, label, badge, ...props }, ref) {
  const { c } = useTheme();
  const color = isFocused ? c.navOnIcon : c.navOff;
  return (
    <Pressable ref={ref} {...props} accessibilityRole="tab" accessibilityLabel={badge ? `${label}, ${badge} waiting` : label} accessibilityState={{ selected: isFocused }} style={{ flex: 1 }}>
      <View style={{ height: TAB_BAR_HEIGHT, alignItems: 'center', justifyContent: 'center', gap: 2 }}>
        <View>
          <Icon name={icon} size={23} color={color} width={isFocused ? 2.1 : 1.8} />
          {badge ? (
            <View style={{ position: 'absolute', top: -4, right: -10, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 5, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={[font('bold'), { fontSize: 11, color: '#FFFFFF' }]}>{badge > 99 ? '99+' : badge}</Text>
            </View>
          ) : null}
        </View>
        <Text style={[font('medium'), { fontSize: 10, color }]}>{label}</Text>
      </View>
    </Pressable>
  );
});

export default function TabLayout() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const { status, drafts } = useStore();
  const pending = drafts.filter((d) => d.status === 'pending').length;
  if (status === 'loading')
    return (
      <View style={{ flex: 1, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={c.sub} />
      </View>
    );
  if (status === 'signed_out') return <Redirect href="/sign-in" />;
  return (
    <Tabs>
      <TabSlot style={{ flex: 1 }} />
      {/* TabList must be a direct child of Tabs so Expo Router can find the triggers. */}
      <TabList style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingBottom: Math.max(insets.bottom, 6), flexDirection: 'row', backgroundColor: c.nav, borderTopWidth: HAIRLINE, borderTopColor: c.sep }}>
        <TabTrigger name="index" href="/" asChild>
          <TabButton icon="today" label="Today" />
        </TabTrigger>
        <TabTrigger name="followup" href="/followup" asChild>
          <TabButton icon="chat" label="Follow up" badge={pending} />
        </TabTrigger>
        <TabTrigger name="leads" href="/leads" asChild>
          <TabButton icon="leads" label="Hot & warm" />
        </TabTrigger>
        <TabTrigger name="pipeline" href="/pipeline" asChild>
          <TabButton icon="board" label="Pipeline" />
        </TabTrigger>
        <TabTrigger name="me" href="/me" asChild>
          <TabButton icon="me" label="Me" />
        </TabTrigger>
      </TabList>
    </Tabs>
  );
}
