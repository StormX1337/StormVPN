'use client';

import {
  Button,
  Card,
  CountryFlag,
  EmptyState,
  Input,
  LoadMeter,
  NativeSelect,
  PageHeader,
  Skeleton,
  StatusBadge,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tooltip,
  toast,
} from '@stormvpn/ui';
import { estimateLatencyMs, getCountry, haversineKm, Region, ServerClass, type ServerDto } from '@stormvpn/types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, Search, ServerOff, Star } from 'lucide-react';
import { useDeferredValue, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { keys, useMe, usePublicIp } from '@/lib/queries';
import { ConnectDialog } from './connect-dialog';

const REGION_LABEL: Record<string, string> = {
  EUROPE: 'Europe',
  NORTH_AMERICA: 'North America',
  SOUTH_AMERICA: 'South America',
  ASIA_PACIFIC: 'Asia Pacific',
  MIDDLE_EAST: 'Middle East',
  AFRICA: 'Africa',
  OCEANIA: 'Oceania',
};

function useLatencyEstimator() {
  const { data: ip } = usePublicIp();
  const { data: me } = useMe();
  const origin = getCountry(ip?.protected ? me?.preferredCountry : (ip?.country ?? me?.preferredCountry));
  return (server: ServerDto) =>
    origin && server.latitude !== null && server.longitude !== null
      ? estimateLatencyMs(haversineKm(origin, { lat: server.latitude, lon: server.longitude }))
      : null;
}

export function ServersView() {
  const client = useQueryClient();
  const [search, setSearch] = useState('');
  const [region, setRegion] = useState('');
  const [serverClass, setServerClass] = useState('');
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  const [target, setTarget] = useState<ServerDto | null>(null);
  const deferredSearch = useDeferredValue(search);
  const filters = { search: deferredSearch || undefined, region: region || undefined, serverClass: serverClass || undefined, onlyAvailable: onlyAvailable || undefined };
  const { data: servers, isLoading, isPlaceholderData } = useQuery({
    queryKey: keys.servers(filters),
    queryFn: () => api.servers.list(filters as never),
    placeholderData: (previous) => previous,
    refetchInterval: 30_000,
  });
  const latency = useLatencyEstimator();
  const sorted = useMemo(
    () => [...(servers ?? [])].sort((a, b) => Number(b.isFavorite) - Number(a.isFavorite) || Number(b.allowed) - Number(a.allowed)),
    [servers],
  );

  const toggleFavorite = async (server: ServerDto) => {
    try {
      await (server.isFavorite ? api.servers.unfavorite(server.id) : api.servers.favorite(server.id));
      await client.invalidateQueries({ queryKey: ['servers'] });
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <>
      <PageHeader title="Servers" description="Every location runs on StormVPN operated WireGuard nodes." />
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <div className="relative md:w-72">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search city, country or server" value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search servers" />
        </div>
        <NativeSelect className="md:w-48" value={region} onChange={(event) => setRegion(event.target.value)} aria-label="Region">
          <option value="">All regions</option>
          {Object.values(Region).map((value) => (
            <option key={value} value={value}>
              {REGION_LABEL[value]}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect className="md:w-44" value={serverClass} onChange={(event) => setServerClass(event.target.value)} aria-label="Server class">
          <option value="">All server classes</option>
          {Object.values(ServerClass).map((value) => (
            <option key={value} value={value}>
              {value.charAt(0) + value.slice(1).toLowerCase()}
            </option>
          ))}
        </NativeSelect>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Switch checked={onlyAvailable} onCheckedChange={setOnlyAvailable} /> Only available to me
        </label>
      </div>
      <Card className={`p-0 transition-opacity ${isPlaceholderData ? 'opacity-60' : ''}`}>
        {isLoading ? (
          <div className="space-y-2 p-5">
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton key={index} className="h-10" />
            ))}
          </div>
        ) : sorted.length === 0 ? (
          <EmptyState className="m-5" icon={<ServerOff />} title="No servers match your filters" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-10" />
                <TableHead>Location</TableHead>
                <TableHead>Server</TableHead>
                <TableHead>Ping</TableHead>
                <TableHead className="w-44">Load</TableHead>
                <TableHead>Capacity</TableHead>
                <TableHead>IP address</TableHead>
                <TableHead>Protocol</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((server) => {
                const ping = latency(server);
                const usable = server.allowed && (server.status === 'ONLINE' || server.status === 'DEGRADED');
                return (
                  <TableRow key={server.id}>
                    <TableCell>
                      <button
                        type="button"
                        onClick={() => void toggleFavorite(server)}
                        aria-label={server.isFavorite ? 'Remove favorite' : 'Add favorite'}
                        aria-pressed={server.isFavorite}
                        className="rounded p-1 text-muted-foreground hover:text-foreground"
                      >
                        <Star className={`size-4 ${server.isFavorite ? 'fill-status-warning text-status-warning' : ''}`} />
                      </button>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <CountryFlag code={server.countryCode} />
                        <div>
                          <div className="font-medium">{server.city}</div>
                          <div className="text-xs text-muted-foreground">{server.countryName}</div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="font-mono text-xs">{server.name}</div>
                      <div className="text-xs text-muted-foreground">{server.serverClass.toLowerCase()}</div>
                    </TableCell>
                    <TableCell className="tabular text-muted-foreground">
                      {ping !== null ? (
                        <Tooltip content="Estimated from distance – the StormVPN apps measure real latency">
                          <span>~{ping} ms</span>
                        </Tooltip>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell>
                      <LoadMeter value={server.load} label={`${server.name} load`} />
                    </TableCell>
                    <TableCell className="tabular text-muted-foreground">
                      {server.availableCapacity} free <span className="text-xs">/ {server.capacity}</span>
                    </TableCell>
                    <TableCell className="tabular font-mono text-xs">{server.publicIpv4}</TableCell>
                    <TableCell className="text-xs">WireGuard</TableCell>
                    <TableCell>
                      <StatusBadge status={server.status} />
                    </TableCell>
                    <TableCell className="text-right">
                      {server.allowed ? (
                        <Button size="sm" variant={usable ? 'default' : 'outline'} disabled={!usable} onClick={() => setTarget(server)}>
                          Connect
                        </Button>
                      ) : (
                        <Tooltip content="Not included in your plan">
                          <Button size="sm" variant="ghost" asChild>
                            <a href="/subscription">
                              <Lock /> Upgrade
                            </a>
                          </Button>
                        </Tooltip>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>
      <ConnectDialog server={target} onClose={() => setTarget(null)} />
    </>
  );
}
