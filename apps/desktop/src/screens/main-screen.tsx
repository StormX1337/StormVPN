import { generateWireGuardKeyPair, injectPrivateKey } from '@stormvpn/crypto';
import type { ConnectionDto, ServerDto, UserDto, VpnStatusDto } from '@stormvpn/types';
import {
  Badge,
  Button,
  CountryFlag,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  Logo,
  Spinner,
  cn,
  formatBytes,
  formatDuration,
  toast,
} from '@stormvpn/ui';
import { ArrowDown, ArrowUp, Globe, Lock, LogOut, Menu, Moon, Power, Sun, Zap } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { type Api, clearSession, errorMessage } from '../lib/api';
import { native, type TunnelState } from '../lib/native';
import { openExternal } from '../lib/open';
import { settings } from '../lib/settings';

const CLIENT_VERSION = '1.0.0';

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

export function MainScreen({
  api,
  apiUrl,
  user,
  onLoggedOut,
}: {
  api: Api;
  apiUrl: string;
  user: UserDto;
  onLoggedOut: () => void;
}) {
  const { resolvedTheme, setTheme } = useTheme();
  const [tunnel, setTunnel] = useState<TunnelState>('disconnected');
  const [busy, setBusy] = useState<'connect' | 'disconnect' | null>(null);
  const [servers, setServers] = useState<ServerDto[]>([]);
  const [selected, setSelected] = useState<string | null>(() => settings.serverId());
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<VpnStatusDto | null>(null);
  const [connection, setConnection] = useState<ConnectionDto | null>(null);

  const refreshTunnel = useCallback(async () => {
    setTunnel(await native.state().catch(() => 'disconnected' as const));
  }, []);

  const refreshStatus = useCallback(async () => {
    try {
      const [vpnStatus, active] = await Promise.all([
        api.connections.status(),
        api.connections.active(),
      ]);
      setStatus(vpnStatus);
      const id = settings.connectionId();
      setConnection(active.find((item) => item.id === id) ?? null);
    } catch {
      // Keep the last known values; the next poll retries.
    }
  }, [api]);

  useEffect(() => {
    void refreshTunnel();
    void refreshStatus();
    api.servers
      .list()
      .then(setServers)
      .catch((error: unknown) => toast.error(errorMessage(error)));
    const fast = setInterval(() => void refreshTunnel(), 2000);
    const slow = setInterval(() => void refreshStatus(), 8000);
    return () => {
      clearInterval(fast);
      clearInterval(slow);
    };
  }, [api, refreshStatus, refreshTunnel]);

  const ensureDevice = useCallback(async (): Promise<string> => {
    const devices = await api.devices.list();
    const stored = settings.deviceId();
    if (stored && devices.some((device) => device.id === stored)) return stored;
    // Device names allow letters, digits, spaces and . _ ' ( ) - only.
    const host = (await native.deviceName()).replace(/[^\p{L}\p{N} ._'()-]/gu, '-');
    const name = `Windows (${host})`.slice(0, 64);
    const device =
      devices.find((item) => item.platform === 'WINDOWS' && item.name === name) ??
      (await api.devices.create({ name, platform: 'WINDOWS', clientVersion: CLIENT_VERSION }));
    settings.setDeviceId(device.id);
    return device.id;
  }, [api]);

  const endApiConnection = useCallback(async () => {
    const id = settings.connectionId();
    settings.setConnectionId(null);
    if (id) await api.connections.disconnect(id).catch(() => undefined);
  }, [api]);

  const connect = useCallback(
    async (serverId: string | null) => {
      setBusy('connect');
      try {
        await native.disconnect();
        await endApiConnection();
        const deviceId = await ensureDevice();
        // The private key is generated here and only ever written into the local tunnel config.
        const keys = generateWireGuardKeyPair();
        const result = await api.connections.connect({
          deviceId,
          serverId: serverId ?? undefined,
          publicKey: keys.publicKey,
        });
        settings.setConnectionId(result.connection.id);
        setConnection(result.connection);
        await native.connect(injectPrivateKey(result.wireguard.config, keys.privateKey));
        toast.success(`Connected to ${result.wireguard.server.name}`);
      } catch (error) {
        toast.error(errorMessage(error, 'Could not connect'));
        await endApiConnection();
      } finally {
        setBusy(null);
        void refreshTunnel();
        void refreshStatus();
      }
    },
    [api, endApiConnection, ensureDevice, refreshStatus, refreshTunnel],
  );

  const disconnect = useCallback(async () => {
    setBusy('disconnect');
    try {
      await native.disconnect();
      await endApiConnection();
      setConnection(null);
    } catch (error) {
      toast.error(errorMessage(error, 'Could not disconnect'));
    } finally {
      setBusy(null);
      void refreshTunnel();
      void refreshStatus();
    }
  }, [endApiConnection, refreshStatus, refreshTunnel]);

  const logout = useCallback(async () => {
    await disconnect();
    await api.auth.logout().catch(() => undefined);
    clearSession();
    onLoggedOut();
  }, [api, disconnect, onLoggedOut]);

  const chooseServer = (serverId: string | null) => {
    setSelected(serverId);
    settings.setServerId(serverId);
    if (tunnel === 'connected' || tunnel === 'connecting') void connect(serverId);
  };

  const connected = tunnel === 'connected';
  const working = busy !== null || tunnel === 'connecting' || tunnel === 'disconnecting';
  const now = useNow(connected);
  const since = connection?.connectedAt ?? connection?.startedAt ?? null;
  const currentServer = connection?.server ?? null;
  const selectedServer = servers.find((server) => server.id === selected) ?? null;

  const visibleServers = useMemo(() => {
    const query = search.trim().toLowerCase();
    return servers.filter(
      (server) =>
        !query ||
        server.name.toLowerCase().includes(query) ||
        server.city.toLowerCase().includes(query) ||
        server.countryName.toLowerCase().includes(query),
    );
  }, [search, servers]);

  const headline =
    busy === 'connect' || tunnel === 'connecting'
      ? 'Connecting…'
      : busy === 'disconnect' || tunnel === 'disconnecting'
        ? 'Disconnecting…'
        : connected
          ? 'Protected'
          : 'Not protected';

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b px-4 py-3">
        <Logo />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Menu">
              <Menu />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <div className="text-muted-foreground px-2 py-1.5 text-xs">{user.email}</div>
            <DropdownMenuItem onSelect={() => openExternal(`${apiUrl}/dashboard`)}>
              <Globe /> Open dashboard
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
            >
              {resolvedTheme === 'dark' ? <Sun /> : <Moon />} Toggle theme
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void logout()}>
              <LogOut /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <section className="flex flex-col items-center gap-4 px-6 pt-8 pb-6">
        <button
          type="button"
          disabled={working}
          onClick={() => void (connected ? disconnect() : connect(selected))}
          aria-label={connected ? 'Disconnect' : 'Connect'}
          className={cn(
            'flex size-36 items-center justify-center rounded-full border-4 transition-all disabled:opacity-70',
            connected
              ? 'border-status-good/60 bg-status-good/15 text-status-good shadow-status-good/60 shadow-[0_0_60px_-10px]'
              : 'border-border bg-card text-muted-foreground hover:border-sky-500/60 hover:text-sky-400',
          )}
        >
          {working ? <Spinner className="size-10" /> : <Power className="size-14" />}
        </button>
        <div className="text-center">
          <div
            className={cn(
              'text-2xl font-semibold',
              connected ? 'text-status-good' : 'text-foreground',
            )}
          >
            {headline}
          </div>
          <div className="text-muted-foreground mt-1 text-sm">
            {connected && currentServer ? (
              <>
                <CountryFlag code={currentServer.countryCode} /> {currentServer.name} ·{' '}
                {currentServer.city}
              </>
            ) : selectedServer ? (
              <>
                <CountryFlag code={selectedServer.countryCode} /> {selectedServer.name} ·{' '}
                {selectedServer.city}
              </>
            ) : (
              'Quick Connect – best available server'
            )}
          </div>
        </div>
        <div className="grid w-full grid-cols-3 gap-2 text-center text-xs">
          <div className="bg-card rounded-lg border p-2">
            <div className="text-muted-foreground">Public IP</div>
            <div className="tabular mt-0.5 truncate font-medium">{status?.publicIp ?? '—'}</div>
          </div>
          <div className="bg-card rounded-lg border p-2">
            <div className="text-muted-foreground flex items-center justify-center gap-1">
              <ArrowDown className="size-3" /> Down
            </div>
            <div className="tabular mt-0.5 font-medium">
              {connected ? formatBytes(connection?.txBytes ?? 0) : '—'}
            </div>
          </div>
          <div className="bg-card rounded-lg border p-2">
            <div className="text-muted-foreground flex items-center justify-center gap-1">
              <ArrowUp className="size-3" /> Up
            </div>
            <div className="tabular mt-0.5 font-medium">
              {connected ? formatBytes(connection?.rxBytes ?? 0) : '—'}
            </div>
          </div>
        </div>
        {connected && since ? (
          <div className="text-muted-foreground tabular text-xs">
            Session {formatDuration((now - new Date(since).getTime()) / 1000)}
          </div>
        ) : null}
      </section>

      <section className="flex min-h-0 flex-1 flex-col border-t">
        <div className="p-3">
          <Input
            placeholder="Search locations"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          <li>
            <ServerRow
              active={selected === null}
              onClick={() => chooseServer(null)}
              icon={<Zap className="size-4 text-sky-400" />}
              title="Quick Connect"
              subtitle="Fastest server for your plan"
            />
          </li>
          {visibleServers.map((server) => (
            <li key={server.id}>
              <ServerRow
                active={selected === server.id}
                disabled={!server.allowed || server.status === 'OFFLINE'}
                onClick={() => chooseServer(server.id)}
                icon={<CountryFlag code={server.countryCode} className="text-lg" />}
                title={`${server.city}, ${server.countryName}`}
                subtitle={server.name}
                trailing={
                  !server.allowed ? (
                    <Lock className="text-muted-foreground size-4" />
                  ) : server.status === 'OFFLINE' ? (
                    <Badge variant="outline">Offline</Badge>
                  ) : (
                    <span className="text-muted-foreground tabular text-xs">
                      {Math.round(server.load)}%
                    </span>
                  )
                }
              />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function ServerRow({
  active,
  disabled,
  onClick,
  icon,
  title,
  subtitle,
  trailing,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  trailing?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors disabled:opacity-50',
        active ? 'bg-accent' : 'hover:bg-accent/60',
      )}
    >
      <span className="flex size-6 items-center justify-center">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{title}</span>
        <span className="text-muted-foreground block truncate text-xs">{subtitle}</span>
      </span>
      {trailing}
    </button>
  );
}
