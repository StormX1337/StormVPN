'use client';

import {
  Button,
  Card,
  formatBytes,
  formatDateTime,
  formatRelative,
  humanize,
  Input,
  NativeSelect,
  PageHeader,
  Pagination,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@stormvpn/ui';
import { useQuery } from '@tanstack/react-query';
import { useDeferredValue, useState } from 'react';
import { api } from '@/lib/api';
import { useAction } from '@/lib/use-action';

export function ConnectionsView() {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const { data } = useQuery({
    queryKey: ['admin', 'connections', status, page],
    queryFn: () => api.admin.connections({ status, page }),
    refetchInterval: 10_000,
    placeholderData: (previous) => previous,
  });
  const terminate = useAction((id: string) => api.admin.terminateConnection(id), {
    success: 'Connection terminated',
    invalidate: [['admin', 'connections']],
  });
  return (
    <>
      <PageHeader
        title="Connections"
        description="Live WireGuard sessions across all nodes (refreshes every 10 s)."
      />
      <NativeSelect
        className="sm:w-48"
        value={status}
        onChange={(event) => setStatus(event.target.value)}
        aria-label="Status"
      >
        <option value="">Live (connecting + connected)</option>
        <option value="CONNECTED">Connected</option>
        <option value="CONNECTING">Connecting</option>
        <option value="DISCONNECTED">Disconnected</option>
        <option value="FAILED">Failed</option>
      </NativeSelect>
      <Card className="p-0">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>User</TableHead>
              <TableHead>Server</TableHead>
              <TableHead>Device</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Since</TableHead>
              <TableHead>Handshake</TableHead>
              <TableHead>Traffic</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {data?.items.map((row) => (
              <TableRow key={row.id}>
                <TableCell>{row.userEmail}</TableCell>
                <TableCell className="font-mono text-xs">{row.serverName}</TableCell>
                <TableCell className="text-muted-foreground">
                  {row.deviceName ?? 'config file'}
                </TableCell>
                <TableCell>
                  <StatusBadge status={row.status} />
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatRelative(row.connectedAt ?? row.startedAt)}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatRelative(row.lastHandshakeAt)}
                </TableCell>
                <TableCell className="tabular">{formatBytes(row.rxBytes + row.txBytes)}</TableCell>
                <TableCell className="text-right">
                  {row.status === 'CONNECTED' || row.status === 'CONNECTING' ? (
                    <Button size="sm" variant="outline" onClick={() => terminate.mutate(row.id)}>
                      Terminate
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
            {data?.items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-muted-foreground py-8 text-center">
                  No connections
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
        {data ? (
          <div className="px-4">
            <Pagination
              page={data.page}
              pageSize={data.pageSize}
              total={data.total}
              onPageChange={setPage}
            />
          </div>
        ) : null}
      </Card>
    </>
  );
}

export function LogsView() {
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);
  const deferred = useDeferredValue(action);
  const { data } = useQuery({
    queryKey: ['admin', 'logs', deferred, page],
    queryFn: () => api.admin.logs({ action: deferred, page, pageSize: 50 }),
    placeholderData: (previous) => previous,
  });
  return (
    <>
      <PageHeader
        title="Audit logs"
        description="Append-only record of administrative and security relevant actions."
      />
      <Input
        className="sm:w-72"
        placeholder="Filter by action prefix, e.g. server."
        value={action}
        onChange={(event) => setAction(event.target.value)}
        aria-label="Action filter"
      />
      <Card className="p-0">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Time</TableHead>
              <TableHead>Actor</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Target</TableHead>
              <TableHead>Details</TableHead>
              <TableHead>IP</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data?.items.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="text-muted-foreground">
                  {formatDateTime(row.createdAt)}
                </TableCell>
                <TableCell>
                  {row.actorEmail ?? humanize(row.actorType)}
                  <span className="text-muted-foreground ml-1 text-xs">
                    ({row.actorType.toLowerCase()})
                  </span>
                </TableCell>
                <TableCell className="font-mono text-xs">{row.action}</TableCell>
                <TableCell className="text-muted-foreground font-mono text-xs">
                  {row.targetType ? `${row.targetType}:${row.targetId?.slice(0, 8) ?? ''}` : '—'}
                </TableCell>
                <TableCell
                  className="text-muted-foreground max-w-80 truncate font-mono text-xs"
                  title={row.metadata ? JSON.stringify(row.metadata) : undefined}
                >
                  {row.metadata ? JSON.stringify(row.metadata) : '—'}
                </TableCell>
                <TableCell className="text-muted-foreground font-mono text-xs">
                  {row.ipAddress ?? '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {data ? (
          <div className="px-4">
            <Pagination
              page={data.page}
              pageSize={data.pageSize}
              total={data.total}
              onPageChange={setPage}
            />
          </div>
        ) : null}
      </Card>
    </>
  );
}
