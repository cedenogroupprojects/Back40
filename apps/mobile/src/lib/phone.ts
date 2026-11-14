import { Linking, Platform } from 'react-native';

/** Open the phone's Messages (or Mail) with the text filled in. */
export async function openOnPhone(channel: 'text' | 'email', to: string | null | undefined, body: string, subject = '') {
  const url = channel === 'email' ? `mailto:${to ?? ''}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}` : `sms:${to ?? ''}${Platform.OS === 'android' ? '?' : '&'}body=${encodeURIComponent(body)}`;
  if (Platform.OS === 'web') window.location.href = url;
  else await Linking.openURL(url).catch(() => undefined);
}
