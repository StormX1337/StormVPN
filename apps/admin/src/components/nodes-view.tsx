'use client';

import {
  Button,
  Card,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  formatBitrate,
  formatBytes,
  formatDuration,
  formatRelative,
  humanize,
  LoadMeter,
  PageHeader,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@stormvpn/ui';
import { TimeSeriesChart } from '@stormvpn/ui/charts';
import type { AdminNodeDto } from '@stormvpn/types';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useAction } from '@/lib/use-action';

const CHECK_LABELS: Record<string, string> = { wireguard: 'WireGuard', ipForward: 'IP forwarding', nat: 'NAT masquerade', dryRun: 'Dry run' };

function NodeDetail({ node, onClose }: { node: AdminNodeDto | null; onClose: () => void }) {
  const { data } = useQuery({ queryKey: ['admin', 'node', node?.id], queryFn: () => api.admin.node(node!.id), enabled: !!node, refetchInterval: 30_000 });
  const [confirm, setConfirm] = useState(false);
  const remove = useAction(() => api.admin.deleteNode(node!.id), {
    success: 'Node deregistered',
    invalidate: [['admin', 'nodes'], ['admin', 'servers']],
    onDone: () => {
      setConfirm(false);
      onClose();
    },
  });
  const history = (data?.history ?? []).map((sample) => ({
    at: sample.at,
    cpu: sample.cpuPercent,
    memory: sample.memoryPercent,
  }));
  return (
    <Dialog open={node !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl">
        {node ? (
          <>
            <DialogHeader>
              <DialogTitle>{node.serverName}</DialogTitle>
              <DialogDescription>
                {node.hostname} · agent {node.agentVersion ?? '?'} · {node.publicIpv4 ?? 'no IP reported'}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 text-sm sm:grid-cols-4">
              <div>
                <p className="text-muted-foreground">Uptime</p>
                <p className="font-medium">{formatDuration(node.metrics.uptimeSeconds)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Total traffic</p>
                <p className="font-medium">{formatBytes(node.totalRxBytes + node.totalTxBytes)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Peer sync</p>
                <p className="font-medium">
                  rev {node.appliedPeerRevision} / {node.peerRevision}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Registered</p>
                <p className="font-medium">{formatRelative(node.registeredAt)}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {Object.entries(node.healthChecks ?? {}).map(([name, check]) => (
                <StatusBadge key={name} tone={check.ok ? 'good' : 'critical'} label={`${CHECK_LABELS[name] ?? humanize(name)}${check.message ? `: ${check.message}` : ''}`} />
              ))}
            </div>
            <Card className="p-4">
              <p className="text-sm font-semibold">CPU and memory – last 24 hours</p>
              <TimeSeriesChart
                data={history}
                xKey="at"
                height={200}
                area={false}
                title="Node utilisation"
                series={[
                  { key: 'cpu', label: 'CPU', color: '--chart-1' },
                  { key: 'memory', label: 'Memory', color: '--chart-2' },
                ]}
                formatValue={(value) => `${Math.round(value)}%`}
                formatX={(value) => new Date(value).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
              />
            </Card>
            <div>
              <Button variant="outline" className="text-destructive" onClick={() => setConfirm(true)}>
                Deregister node
              </Button>
            </div>
            <ConfirmDialog
              open={confirm}
              onOpenChange={setConfirm}
              title="Deregister this node?"
              description="Its token stops working immediately. A new enrollment token is needed to register the host again."
              confirmLabel="Deregister"
              destructive
              pending={remove.isPending}
              onConfirm={() => remove.mutate(undefined)}
            />
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export function NodesView() {
  const { data: nodes = [] } = useQuery({ queryKey: ['admin', 'nodes'], queryFn: () => api.admin.nodes(), refetchInterval: 15_000 });
  const [selected, setSelected] = useState<AdminNodeDto | null>(null);
  return (
    <>
      <PageHeader title="Nodes" description="Agents report heartbeats every 15 seconds; metrics stream live." />
      <Card className="p-0">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Node</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-36">Load</TableHead>
              <TableHead>CPU</TableHead>
              <TableHead>RAM</TableHead>
              <TableHead>Disk</TableHead>
              <TableHead>Bandwidth</TableHead>
              <TableHead>Peers</TableHead>
              <TableHead>Sync</TableHead>
              <TableHead>Version</TableHead>
              <TableHead>Heartbeat</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {nodes.map((node) => (
              <TableRow key={node.id} className="cursor-pointer" onClick={() => setSelected(node)}>
                <TableCell>
                  <div className="font-mono text-xs font-semibold">{node.serverName}</div>
                  <div className="text-xs text-muted-foreground">{node.publicIpv4}</div>
                </TableCell>
                <TableCell>
                  <StatusBadge status={node.status} />
                </TableCell>
                <TableCell>
                  <LoadMeter value={node.metrics.load} label={`${node.serverName} load`} />
                </TableCell>
                <TableCell className="tabular">{node.metrics.cpuPercent.toFixed(0)}%</TableCell>
                <TableCell className="tabular">{node.metrics.memoryPercent.toFixed(0)}%</TableCell>
                <TableCell className="tabular">{node.metrics.diskPercent.toFixed(0)}%</TableCell>
                <TableCell className="tabular text-muted-foreground">{formatBitrate(Math.max(node.metrics.rxBps, node.metrics.txBps))}</TableCell>
                <TableCell className="tabular">
                  {node.metrics.activePeers} <span className="text-xs text-muted-foreground">({node.metrics.activeConnections} live)</span>
                </TableCell>
                <TableCell>
                  <StatusBadge tone={node.appliedPeerRevision === node.peerRevision ? 'good' : 'warning'} label={node.appliedPeerRevision === node.peerRevision ? 'In sync' : 'Pending'} />
                </TableCell>
                <TableCell className="font-mono text-xs">{node.agentVersion ?? '—'}</TableCell>
                <TableCell className="text-muted-foreground">{formatRelative(node.lastHeartbeatAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      <NodeDetail node={selected} onClose={() => setSelected(null)} />
    </>
  );
}
