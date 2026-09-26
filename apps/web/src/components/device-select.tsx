'use client';

import { NativeSelect } from '@stormvpn/ui';
import type { DeviceDto } from '@stormvpn/types';
import { PLATFORM_LABEL } from './platform-icon';

export function DeviceSelect({ devices, value, onChange, id = 'device' }: { devices: DeviceDto[]; value: string; onChange: (value: string) => void; id?: string }) {
  return (
    <NativeSelect id={id} value={value} onChange={(event) => onChange(event.target.value)} aria-label="Device">
      {devices.map((device) => (
        <option key={device.id} value={device.id}>
          {device.name} ({PLATFORM_LABEL[device.platform]})
        </option>
      ))}
    </NativeSelect>
  );
}
