import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { Linking, Platform } from 'react-native';

import type { Lead } from '@back40/core';

/**
 * Tap-to-call through the phone's own dialer (no per-minute cost), then show
 * the After-the-call sheet so it's waiting when the agent comes back.
 */
export async function callLead(lead: Lead) {
  if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
  router.push(`/log-call/${lead.id}`);
  const digits = (lead.phone ?? '').replace(/[^\d+]/g, '');
  if (!digits) return;
  if (Platform.OS === 'web') {
    // Phone browsers hand tel: links to the dialer.
    if (/iPhone|iPad|Android/i.test(navigator.userAgent)) window.location.href = `tel:${digits}`;
  } else {
    await Linking.openURL(`tel:${digits}`).catch(() => undefined);
  }
}

export function textLead(lead: Lead) {
  router.push(`/compose/${lead.id}`);
}

export function tap() {
  if (Platform.OS !== 'web') Haptics.selectionAsync().catch(() => undefined);
}
