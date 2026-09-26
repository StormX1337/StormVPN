'use client';

import {
  Alert,
  Button,
  CopyButton,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@stormvpn/ui';
import { Download, KeyRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { configQrCode, downloadConfig, type GeneratedConfig } from '@/lib/wireguard';

/**
 * Shows a freshly generated WireGuard configuration. The private key was
 * created in the browser and is shown exactly once.
 */
export function ConfigDialog({ config, onClose }: { config: GeneratedConfig | null; onClose: () => void }) {
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => {
    setQr(null);
    if (config) void configQrCode(config.config).then(setQr);
  }, [config]);

  return (
    <Dialog open={config !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        {config ? (
          <>
            <DialogHeader>
              <DialogTitle>
                {config.server.name} · {config.server.city}
              </DialogTitle>
              <DialogDescription>
                Import this configuration into the official WireGuard app (Windows, macOS, Linux, Android, iOS) or a StormVPN client.
              </DialogDescription>
            </DialogHeader>
            <Alert>
              <KeyRound />
              <span>
                Your private key was generated on this device and never sent to StormVPN. Save the file now – it cannot be shown again.
              </span>
            </Alert>
            <Tabs defaultValue="file">
              <TabsList>
                <TabsTrigger value="file">Config file</TabsTrigger>
                <TabsTrigger value="qr">QR code (mobile)</TabsTrigger>
                <TabsTrigger value="help">How to connect</TabsTrigger>
              </TabsList>
              <TabsContent value="file" className="space-y-3">
                <pre className="max-h-64 overflow-auto rounded-lg border bg-muted/60 p-3 font-mono text-xs leading-relaxed">{config.config}</pre>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => downloadConfig(config)}>
                    <Download /> Download {config.fileName}
                  </Button>
                  <CopyButton value={config.config} label="Copy config" />
                </div>
              </TabsContent>
              <TabsContent value="qr" className="flex flex-col items-center gap-3">
                {qr ? <img src={qr} alt="WireGuard configuration QR code" className="size-64 rounded-xl bg-white p-2" /> : null}
                <p className="text-center text-sm text-muted-foreground">Open WireGuard on your phone → “+” → “Scan from QR code”.</p>
              </TabsContent>
              <TabsContent value="help">
                <ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
                  <li>Install WireGuard from wireguard.com/install or your app store.</li>
                  <li>Import the downloaded file (desktop) or scan the QR code (mobile).</li>
                  <li>
                    Enable the tunnel. Your dashboard switches to <strong className="text-foreground">Protected</strong> after the first handshake.
                  </li>
                  <li>Recommended: enable “Block untunneled traffic (kill switch)” in the WireGuard app on Windows/macOS/iOS.</li>
                </ol>
              </TabsContent>
            </Tabs>
            <p className="text-xs text-muted-foreground">
              Assigned address {config.assignedIpv4} · {config.selectionReason}
            </p>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
