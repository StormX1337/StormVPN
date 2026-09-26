'use client';

import {
  Alert,
  Button,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  CopyButton,
  Field,
  formatDateTime,
  formatRelative,
  humanize,
  Input,
  NativeSelect,
  PageHeader,
  StatusBadge,
  toast,
} from '@stormvpn/ui';
import { COUNTRIES, type SecurityEventDto } from '@stormvpn/types';
import { changePasswordSchema } from '@stormvpn/validation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Laptop, ShieldCheck, Smartphone } from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { keys, useMe, useSecurityEvents, useSessions } from '@/lib/queries';

function ProfileCard() {
  const client = useQueryClient();
  const { data: user } = useMe();
  const update = useMutation({
    mutationFn: (input: { name: string | null; preferredCountry: string | null }) => api.user.update(input),
    onSuccess: (updated) => {
      client.setQueryData(keys.me, updated);
      toast.success('Profile saved');
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  if (!user) return null;
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Profile</CardTitle>
          <CardDescription>Your preferred country guides Quick Connect.</CardDescription>
        </div>
      </CardHeader>
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          update.mutate({
            name: String(form.get('name') ?? '').trim() || null,
            preferredCountry: String(form.get('preferredCountry') ?? '') || null,
          });
        }}
      >
        <Field label="Name" htmlFor="name">
          <Input id="name" name="name" defaultValue={user.name ?? ''} />
        </Field>
        <Field label="Email" htmlFor="email" hint={user.emailVerified ? 'Verified' : 'Not verified yet'}>
          <Input id="email" value={user.email} disabled />
        </Field>
        <Field label="Preferred country" htmlFor="preferredCountry">
          <NativeSelect id="preferredCountry" name="preferredCountry" defaultValue={user.preferredCountry ?? ''}>
            <option value="">Automatic (nearest)</option>
            {COUNTRIES.map((country) => (
              <option key={country.code} value={country.code}>
                {country.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <div className="flex items-end">
          <Button type="submit" disabled={update.isPending}>
            Save profile
          </Button>
        </div>
      </form>
    </Card>
  );
}

function PasswordCard() {
  const [error, setError] = useState<string>();
  const change = useMutation({
    mutationFn: (input: { currentPassword: string; newPassword: string }) => api.account.changePassword(input),
    onSuccess: () => toast.success('Password changed. Other sessions were signed out.'),
    onError: (caught) => setError(errorMessage(caught)),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Password</CardTitle>
      </CardHeader>
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const parsed = changePasswordSchema.safeParse({ currentPassword: form.get('currentPassword'), newPassword: form.get('newPassword') });
          if (!parsed.success) return setError(parsed.error.issues[0]!.message);
          setError(undefined);
          change.mutate(parsed.data, { onSuccess: () => event.currentTarget?.reset() });
        }}
      >
        <Field label="Current password" htmlFor="currentPassword">
          <Input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" />
        </Field>
        <Field label="New password" htmlFor="newPassword" error={error} hint="At least 12 characters">
          <Input id="newPassword" name="newPassword" type="password" autoComplete="new-password" />
        </Field>
        <div>
          <Button type="submit" disabled={change.isPending}>
            Change password
          </Button>
        </div>
      </form>
    </Card>
  );
}

function TwoFactorCard() {
  const client = useQueryClient();
  const { data: user } = useMe();
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  useEffect(() => {
    if (setup) void QRCode.toDataURL(setup.otpauthUrl, { margin: 1, width: 200 }).then(setQr);
  }, [setup]);

  const begin = useMutation({ mutationFn: () => api.account.setupTwoFactor(), onSuccess: setSetup, onError: (error) => toast.error(errorMessage(error)) });
  const enable = useMutation({
    mutationFn: () => api.account.enableTwoFactor(code),
    onSuccess: ({ backupCodes: codes }) => {
      setBackupCodes(codes);
      setSetup(null);
      setCode('');
      void client.invalidateQueries({ queryKey: keys.me });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const disable = useMutation({
    mutationFn: () => api.account.disableTwoFactor(password, code),
    onSuccess: () => {
      setPassword('');
      setCode('');
      toast.success('Two-factor authentication disabled');
      void client.invalidateQueries({ queryKey: keys.me });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Two-factor authentication</CardTitle>
          <CardDescription>Protect your account with an authenticator app (TOTP).</CardDescription>
        </div>
        <StatusBadge tone={user?.twoFactorEnabled ? 'good' : 'warning'} label={user?.twoFactorEnabled ? 'Enabled' : 'Disabled'} />
      </CardHeader>
      {backupCodes ? (
        <Alert variant="success" className="flex-col">
          <p className="font-medium">Save your backup codes – each works once if you lose your phone.</p>
          <div className="grid grid-cols-2 gap-1 font-mono text-sm">
            {backupCodes.map((backupCode) => (
              <span key={backupCode}>{backupCode}</span>
            ))}
          </div>
          <div className="flex gap-2">
            <CopyButton value={backupCodes.join('\n')} label="Copy codes" />
            <Button size="sm" variant="ghost" onClick={() => setBackupCodes(null)}>
              I saved them
            </Button>
          </div>
        </Alert>
      ) : user?.twoFactorEnabled ? (
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <Field label="Password" htmlFor="tfa-password">
            <Input id="tfa-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </Field>
          <Field label="Code" htmlFor="tfa-disable-code">
            <Input id="tfa-disable-code" inputMode="numeric" value={code} onChange={(event) => setCode(event.target.value)} placeholder="123456" />
          </Field>
          <Button variant="outline" disabled={disable.isPending || !password || !code} onClick={() => disable.mutate()}>
            Disable 2FA
          </Button>
        </div>
      ) : setup ? (
        <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
          {qr ? <img src={qr} alt="Authenticator QR code" className="size-44 rounded-lg bg-white p-2" /> : <div className="size-44" />}
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">Scan the QR code with Google Authenticator, 1Password, Authy or similar, then enter the 6-digit code.</p>
            <p className="font-mono text-xs break-all">{setup.secret}</p>
            <div className="flex gap-2">
              <Input inputMode="numeric" value={code} onChange={(event) => setCode(event.target.value)} placeholder="123456" aria-label="Verification code" className="w-36" />
              <Button disabled={enable.isPending || code.length !== 6} onClick={() => enable.mutate()}>
                Enable
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div>
          <Button onClick={() => begin.mutate()} disabled={begin.isPending}>
            <KeyRound /> Set up 2FA
          </Button>
        </div>
      )}
    </Card>
  );
}

function SessionsCard() {
  const client = useQueryClient();
  const { data: sessions = [] } = useSessions();
  const revoke = useMutation({
    mutationFn: (id: string) => api.account.revokeSession(id),
    onSuccess: () => void client.invalidateQueries({ queryKey: keys.sessions }),
    onError: (error) => toast.error(errorMessage(error)),
  });
  const revokeOthers = useMutation({
    mutationFn: () => api.account.revokeOtherSessions(),
    onSuccess: ({ revoked }) => {
      toast.success(`${revoked} session(s) signed out`);
      void client.invalidateQueries({ queryKey: keys.sessions });
    },
  });
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Active sessions</CardTitle>
          <CardDescription>Browsers and apps signed in to your account.</CardDescription>
        </div>
        <Button size="sm" variant="outline" disabled={sessions.length < 2} onClick={() => revokeOthers.mutate()}>
          Sign out others
        </Button>
      </CardHeader>
      <ul className="divide-y">
        {sessions.map((session) => (
          <li key={session.id} className="flex items-center gap-3 py-3 text-sm">
            {session.clientType === 'NATIVE' ? <Smartphone className="size-4 text-muted-foreground" /> : <Laptop className="size-4 text-muted-foreground" />}
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{session.userAgent ?? 'Unknown client'}</p>
              <p className="text-xs text-muted-foreground">
                {session.ipAddress} · active {formatRelative(session.lastUsedAt)}
              </p>
            </div>
            {session.current ? (
              <StatusBadge tone="good" label="This device" />
            ) : (
              <Button size="sm" variant="ghost" onClick={() => revoke.mutate(session.id)}>
                Revoke
              </Button>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function SecurityLogCard() {
  const { data: events = [] } = useSecurityEvents();
  const tone = (event: SecurityEventDto) => (event.severity === 'HIGH' || event.severity === 'CRITICAL' ? 'critical' : event.severity === 'MEDIUM' ? 'warning' : 'neutral');
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Security log</CardTitle>
          <CardDescription>Sign-ins and security relevant changes.</CardDescription>
        </div>
        <ShieldCheck className="size-4 text-muted-foreground" />
      </CardHeader>
      <ul className="max-h-80 divide-y overflow-y-auto">
        {events.map((event) => (
          <li key={event.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
            <div>
              <p className="font-medium">{humanize(event.type)}</p>
              <p className="text-xs text-muted-foreground">
                {formatDateTime(event.createdAt)}
                {event.ipAddress ? ` · ${event.ipAddress}` : ''}
              </p>
            </div>
            <StatusBadge tone={tone(event)} label={humanize(event.severity)} />
          </li>
        ))}
        {events.length === 0 ? <li className="py-6 text-center text-sm text-muted-foreground">No events yet</li> : null}
      </ul>
    </Card>
  );
}

function DangerZone() {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const remove = useMutation({
    mutationFn: () => api.account.delete(password),
    onSuccess: () => window.location.assign('/?deleted=1'),
    onError: (error) => toast.error(errorMessage(error)),
  });
  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <div>
          <CardTitle>Delete account</CardTitle>
          <CardDescription>Cancels your subscription, revokes all devices and removes personal data.</CardDescription>
        </div>
        <Button variant="destructive" size="sm" onClick={() => setOpen(true)}>
          Delete account
        </Button>
      </CardHeader>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Delete your StormVPN account?"
        description="This cannot be undone. Invoices are kept anonymised for legal accounting requirements."
        confirmLabel="Delete permanently"
        destructive
        pending={remove.isPending}
        onConfirm={() => remove.mutate()}
      >
        <Field label="Confirm with your password" htmlFor="delete-password">
          <Input id="delete-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
        </Field>
      </ConfirmDialog>
    </Card>
  );
}

export function AccountView() {
  return (
    <>
      <PageHeader title="Account" description="Profile, security and sessions." />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <ProfileCard />
          <PasswordCard />
          <TwoFactorCard />
        </div>
        <div className="space-y-4">
          <SessionsCard />
          <SecurityLogCard />
          <DangerZone />
        </div>
      </div>
    </>
  );
}
