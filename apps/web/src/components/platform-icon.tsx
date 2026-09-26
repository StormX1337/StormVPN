import type { DevicePlatform } from '@stormvpn/types';
import { Apple, Laptop, Monitor, Router, Smartphone, Tablet, Terminal } from 'lucide-react';

export const PLATFORM_LABEL: Record<DevicePlatform, string> = {
  WINDOWS: 'Windows',
  MACOS: 'macOS',
  LINUX: 'Linux',
  ANDROID: 'Android',
  IOS: 'iOS',
  ROUTER: 'Router',
  OTHER: 'Other',
};

export function PlatformIcon({ platform, className }: { platform: DevicePlatform; className?: string }) {
  const Icon = { WINDOWS: Monitor, MACOS: Apple, LINUX: Terminal, ANDROID: Smartphone, IOS: Tablet, ROUTER: Router, OTHER: Laptop }[platform];
  return <Icon className={className} aria-hidden />;
}
