'use client';

import { Button, CountryFlag, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field } from '@stormvpn/ui';
import type { ServerDto } from '@stormvpn/types';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useDevices } from '@/lib/queries';
import { ConfigDialog } from './config-dialog';
import { DeviceSelect } from './device-select';
import { useProvision } from './use-provision';

/** Pick a device for a specific server, then connect or just download a config. */
export function ConnectDialog({ server, onClose }: { server: ServerDto | null; onClose: () => void }) {
  const { data: devices = [] } = useDevices();
  const [deviceId, setDeviceId] = useState('');
  const { provision, pending, config, close } = useProvision();
  useEffect(() => {
    if (devices.length && !devices.some((device) => device.id === deviceId)) setDeviceId(devices[0]!.id);
  }, [devices, deviceId]);

  const run = (mode: 'connect' | 'config') => {
    if (!server) return;
    provision({ deviceId, serverId: server.id }, mode);
    onClose();
  };

  return (
    <>
      <Dialog open={server !== null} onOpenChange={(open) => !open && onClose()}>
        <DialogContent>
          {server ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <CountryFlag code={server.countryCode} /> {server.name}
                </DialogTitle>
                <DialogDescription>
                  {server.city}, {server.countryName} · {server.publicIpv4}:{server.wireguardPort}
                </DialogDescription>
              </DialogHeader>
              {devices.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Add a device first.{' '}
                  <Link className="text-foreground underline" href="/devices">
                    Manage devices
                  </Link>
                </p>
              ) : (
                <Field label="Device" htmlFor="connect-device">
                  <DeviceSelect id="connect-device" devices={devices} value={deviceId} onChange={setDeviceId} />
                </Field>
              )}
              <DialogFooter>
                <Button variant="outline" disabled={!deviceId || pending} onClick={() => run('config')}>
                  Download config only
                </Button>
                <Button variant="brand" disabled={!deviceId || pending} onClick={() => run('connect')}>
                  Connect
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
      <ConfigDialog config={config} onClose={close} />
    </>
  );
}
