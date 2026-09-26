'use client';

import {
  Alert,
  Button,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  formatDateTime,
  formatRelative,
  humanize,
  Input,
  NativeSelect,
  PageHeader,
  Pagination,
  StatusBadge,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from '@stormvpn/ui';
import { SecurityEventType, Severity, type SystemSettingsDto } from '@stormvpn/types';
import { useQuery } from '@tanstack/react-query';
import { ShieldAlert, Wrench } from 'lucide-react';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useAction } from '@/lib/use-action';

function EventsTab() {
  const [severity, setSeverity] = useState('');
  const [type, setType] = useState('');
  const [unresolvedOnly, setUnresolvedOnly] = useState(true);
  const [page, setPage] = useState(1);
  const { data } = useQuery({
    queryKey: ['admin', 'security-events', severity, type, unresolvedOnly, page],
    queryFn: () => api.admin.securityEvents({ severity, type, unresolvedOnly: unresolvedOnly ? 'true' : undefined, page }),
    refetchInterval: 30_000,
    placeholderData: (previous) => previous,
  });
  const resolve = useAction((id: string) => api.admin.resolveSecurityEvent(id), { invalidate: [['admin', 'security-events']] });
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <NativeSelect className="sm:w-44" value={severity} onChange={(event) => setSeverity(event.target.value)} aria-label="Severity">
          <option value="">All severities</option>
          {Object.values(Severity).map((value) => (
            <option key={value} value={value}>
              {humanize(value)}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect className="sm:w-64" value={type} onChange={(event) => setType(event.target.value)} aria-label="Event type">
          <option value="">All event types</option>
          {Object.values(SecurityEventType).map((value) => (
            <option key={value} value={value}>
              {humanize(value)}
            </option>
          ))}
        </NativeSelect>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Switch checked={unresolvedOnly} onCheckedChange={setUnresolvedOnly} /> Unresolved only
        </label>
      </div>
      <Card className="p-0">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Time</TableHead>
              <TableHead>Event</TableHead>
              <TableHead>Severity</TableHead>
              <TableHead>User</TableHead>
              <TableHead>IP</TableHead>
              <TableHead>Details</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {data?.items.map((event) => (
              <TableRow key={event.id}>
                <TableCell className="text-muted-foreground">{formatDateTime(event.createdAt)}</TableCell>
                <TableCell>{humanize(event.type)}</TableCell>
                <TableCell>
                  <StatusBadge status={event.severity} label={humanize(event.severity)} />
                </TableCell>
                <TableCell>{event.userEmail ?? '—'}</TableCell>
                <TableCell className="font-mono text-xs">{event.ipAddress ?? '—'}</TableCell>
                <TableCell className="max-w-72 truncate font-mono text-xs text-muted-foreground">{event.metadata ? JSON.stringify(event.metadata) : '—'}</TableCell>
                <TableCell className="text-right">
                  {event.resolvedAt ? (
                    <span className="text-xs text-muted-foreground">resolved {formatRelative(event.resolvedAt)}</span>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => resolve.mutate(event.id)}>
                      Resolve
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {data ? (
          <div className="px-4">
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPageChange={setPage} />
          </div>
        ) : null}
      </Card>
    </div>
  );
}

function RiskFlagsTab() {
  const { data: flags = [] } = useQuery({ queryKey: ['admin', 'risk-flags'], queryFn: () => api.admin.riskFlags() });
  const invalidate = [['admin', 'risk-flags']];
  const create = useAction((input: Parameters<typeof api.admin.createRiskFlag>[0]) => api.admin.createRiskFlag(input), { success: 'Risk flag created', invalidate });
  const resolve = useAction((id: string) => api.admin.resolveRiskFlag(id), { invalidate });
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2 p-0">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Subject</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Score</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Expires</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {flags.map((flag) => (
              <TableRow key={flag.id}>
                <TableCell className="font-mono text-xs">
                  {flag.subjectType.toLowerCase()}:{flag.subjectValue}
                </TableCell>
                <TableCell className="max-w-64 truncate">{flag.reason}</TableCell>
                <TableCell className="tabular">{flag.score}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{flag.source.toLowerCase()}</TableCell>
                <TableCell className="text-muted-foreground">{flag.expiresAt ? formatRelative(flag.expiresAt) : 'never'}</TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="ghost" onClick={() => resolve.mutate(flag.id)}>
                    Resolve
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {flags.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                  No active risk flags
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </Card>
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Flag an IP or account</CardTitle>
            <CardDescription>IP flags ≥ 50 block registrations; user flags add to the abuse score.</CardDescription>
          </div>
        </CardHeader>
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            const form = Object.fromEntries(new FormData(event.currentTarget).entries()) as Record<string, string>;
            create.mutate({
              subjectType: form.subjectType as 'USER' | 'IP',
              subjectValue: form.subjectValue ?? '',
              reason: form.reason ?? '',
              score: Number(form.score),
              expiresInHours: form.expiresInHours ? Number(form.expiresInHours) : null,
            });
          }}
        >
          <NativeSelect name="subjectType" aria-label="Subject type" defaultValue="IP">
            <option value="IP">IP address</option>
            <option value="USER">User ID</option>
          </NativeSelect>
          <Input name="subjectValue" placeholder="203.0.113.5 or user UUID" required />
          <Textarea name="reason" placeholder="Reason" required />
          <div className="grid grid-cols-2 gap-2">
            <Input name="score" type="number" min={1} max={1000} placeholder="Score" defaultValue={50} aria-label="Score" />
            <Input name="expiresInHours" type="number" min={1} placeholder="Expires in h" aria-label="Expires in hours" />
          </div>
          <Button type="submit" disabled={create.isPending}>
            Create flag
          </Button>
        </form>
      </Card>
    </div>
  );
}

export function SecurityView() {
  return (
    <>
      <PageHeader title="Security" description="Security events, abuse monitoring and risk flags." />
      <Tabs defaultValue="events">
        <TabsList>
          <TabsTrigger value="events">Security events</TabsTrigger>
          <TabsTrigger value="flags">Risk flags</TabsTrigger>
        </TabsList>
        <TabsContent value="events">
          <EventsTab />
        </TabsContent>
        <TabsContent value="flags">
          <RiskFlagsTab />
        </TabsContent>
      </Tabs>
    </>
  );
}

function SettingsForm({ settings }: { settings: SystemSettingsDto }) {
  const [draft, setDraft] = useState(settings);
  const save = useAction(() => api.admin.updateSettings({ ...draft, defaultDns: draft.defaultDns.length ? draft.defaultDns : undefined }), {
    success: 'Settings saved',
    invalidate: [['admin', 'settings'], ['admin', 'stats']],
  });
  const set = <K extends keyof SystemSettingsDto>(key: K, value: SystemSettingsDto[K]) => setDraft((current) => ({ ...current, [key]: value }));
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Maintenance mode</CardTitle>
            <CardDescription>Blocks new customer connections platform-wide. Existing tunnels keep working.</CardDescription>
          </div>
          <Wrench className="size-4 text-muted-foreground" />
        </CardHeader>
        <label className="flex items-center gap-3 text-sm">
          <Switch checked={draft.maintenanceMode} onCheckedChange={(checked) => set('maintenanceMode', checked)} /> Maintenance mode enabled
        </label>
        <Field label="Message shown to customers" htmlFor="maintenanceMessage">
          <Textarea id="maintenanceMessage" value={draft.maintenanceMessage ?? ''} onChange={(event) => set('maintenanceMessage', event.target.value || null)} />
        </Field>
        {draft.maintenanceMode ? (
          <Alert variant="warning">
            <Wrench /> <span>Customers cannot create new connections while maintenance mode is on.</span>
          </Alert>
        ) : null}
      </Card>
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Platform & abuse controls</CardTitle>
            <CardDescription>Runtime tunables – changes apply within seconds.</CardDescription>
          </div>
          <ShieldAlert className="size-4 text-muted-foreground" />
        </CardHeader>
        <label className="flex items-center gap-3 text-sm">
          <Switch checked={draft.registrationEnabled} onCheckedChange={(checked) => set('registrationEnabled', checked)} /> New registrations allowed
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Auto-suspend risk score" htmlFor="abuseAutoSuspendScore">
            <Input id="abuseAutoSuspendScore" type="number" min={10} value={draft.abuseAutoSuspendScore} onChange={(event) => set('abuseAutoSuspendScore', Number(event.target.value))} />
          </Field>
          <Field label="Config generations / hour" htmlFor="maxConfigGenerationsPerHour">
            <Input id="maxConfigGenerationsPerHour" type="number" min={1} value={draft.maxConfigGenerationsPerHour} onChange={(event) => set('maxConfigGenerationsPerHour', Number(event.target.value))} />
          </Field>
          <Field label="Overload threshold (%)" htmlFor="serverOverloadThreshold" hint="Nodes above this load get no new users">
            <Input id="serverOverloadThreshold" type="number" min={50} max={100} value={draft.serverOverloadThreshold} onChange={(event) => set('serverOverloadThreshold', Number(event.target.value))} />
          </Field>
          <Field label="Fallback DNS" htmlFor="defaultDns" hint="Empty = node resolver on the gateway">
            <Input
              id="defaultDns"
              value={draft.defaultDns.join(', ')}
              onChange={(event) =>
                set(
                  'defaultDns',
                  event.target.value
                    .split(',')
                    .map((entry) => entry.trim())
                    .filter(Boolean),
                )
              }
            />
          </Field>
        </div>
      </Card>
      <div className="lg:col-span-2">
        <Button onClick={() => save.mutate(undefined)} disabled={save.isPending}>
          Save settings
        </Button>
      </div>
    </div>
  );
}

export function SettingsView() {
  const { data } = useQuery({ queryKey: ['admin', 'settings'], queryFn: () => api.admin.settings() });
  return (
    <>
      <PageHeader title="Settings" description="Global platform configuration. All changes are audited." />
      {data ? <SettingsForm settings={data} /> : null}
    </>
  );
}
