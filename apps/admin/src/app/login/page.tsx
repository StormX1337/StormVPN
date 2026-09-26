'use client';

import { Alert, Button, Field, Input, Logo, Spinner } from '@stormvpn/ui';
import { useMutation } from '@tanstack/react-query';
import { AlertCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';

export default function AdminLoginPage() {
  const router = useRouter();
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const done = () => {
    router.replace('/');
    router.refresh();
  };
  const login = useMutation({
    mutationFn: (input: { email: string; password: string }) => api.auth.login(input),
    onSuccess: (result) => ('mfaRequired' in result ? setMfaToken(result.mfaToken) : done()),
  });
  const mfa = useMutation({ mutationFn: (code: string) => api.auth.loginMfa(mfaToken!, code), onSuccess: done });
  const error = login.error ?? mfa.error;

  return (
    <div className="hero-glow flex min-h-dvh items-center justify-center px-4">
      <form
        className="w-full max-w-sm space-y-5 rounded-2xl border bg-card/80 p-8 shadow-2xl backdrop-blur"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          if (mfaToken) mfa.mutate(String(form.get('code') ?? ''));
          else login.mutate({ email: String(form.get('email') ?? '').trim().toLowerCase(), password: String(form.get('password') ?? '') });
        }}
      >
        <Logo />
        <div>
          <h1 className="text-xl font-semibold">Admin sign in</h1>
          <p className="text-sm text-muted-foreground">Staff access only. All actions are audited.</p>
        </div>
        {error ? (
          <Alert variant="destructive">
            <AlertCircle />
            <span>{errorMessage(error)}</span>
          </Alert>
        ) : null}
        {mfaToken ? (
          <Field label="Two-factor code" htmlFor="code">
            <Input id="code" name="code" inputMode="numeric" autoFocus autoComplete="one-time-code" />
          </Field>
        ) : (
          <>
            <Field label="Email" htmlFor="email">
              <Input id="email" name="email" type="email" autoComplete="username" required />
            </Field>
            <Field label="Password" htmlFor="password">
              <Input id="password" name="password" type="password" autoComplete="current-password" required />
            </Field>
          </>
        )}
        <Button type="submit" className="w-full" disabled={login.isPending || mfa.isPending}>
          {login.isPending || mfa.isPending ? <Spinner /> : null} {mfaToken ? 'Verify' : 'Sign in'}
        </Button>
      </form>
    </div>
  );
}
