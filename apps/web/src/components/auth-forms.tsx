'use client';

import { isApiError } from '@stormvpn/api-client';
import { Alert, Button, Field, Input, Spinner } from '@stormvpn/ui';
import { loginSchema, mfaCodeSchema, passwordSchema, registerSchema } from '@stormvpn/validation';
import { useMutation } from '@tanstack/react-query';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import type * as React from 'react';
import { api, safeNext } from '@/lib/api';
import { errorMessage } from '@/lib/errors';

function formValues(event: React.FormEvent<HTMLFormElement>): Record<string, string> {
  return Object.fromEntries(new FormData(event.currentTarget).entries()) as Record<string, string>;
}

function FormError({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <Alert variant="destructive">
      <AlertCircle />
      <span>{errorMessage(error)}</span>
    </Alert>
  );
}

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get('next'));
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const finish = () => {
    router.replace(next);
    router.refresh();
  };
  const login = useMutation({
    mutationFn: (input: { email: string; password: string }) => api.auth.login(input),
    onSuccess: (result) => ('mfaRequired' in result ? setMfaToken(result.mfaToken) : finish()),
  });
  const mfa = useMutation({ mutationFn: (code: string) => api.auth.loginMfa(mfaToken!, code), onSuccess: finish });

  if (mfaToken) {
    return (
      <form
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          const code = formValues(event).code ?? '';
          const parsed = mfaCodeSchema.safeParse(code);
          if (!parsed.success) return setFieldErrors({ code: parsed.error.issues[0]!.message });
          setFieldErrors({});
          mfa.mutate(parsed.data);
        }}
      >
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">Two-factor authentication</h1>
          <p className="text-sm text-muted-foreground">Enter the 6-digit code from your authenticator app or a backup code.</p>
        </div>
        <FormError error={mfa.error} />
        <Field label="Verification code" htmlFor="code" error={fieldErrors.code}>
          <Input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" autoFocus placeholder="123456" />
        </Field>
        <Button type="submit" className="w-full" disabled={mfa.isPending}>
          {mfa.isPending ? <Spinner /> : null} Verify
        </Button>
        <button type="button" className="w-full text-center text-sm text-muted-foreground hover:text-foreground" onClick={() => setMfaToken(null)}>
          Use a different account
        </button>
      </form>
    );
  }

  return (
    <form
      className="space-y-5"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const parsed = loginSchema.safeParse(formValues(event));
        if (!parsed.success) {
          return setFieldErrors(Object.fromEntries(parsed.error.issues.map((issue) => [String(issue.path[0]), issue.message])));
        }
        setFieldErrors({});
        login.mutate(parsed.data);
      }}
    >
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">Welcome back</h1>
        <p className="text-sm text-muted-foreground">Sign in to manage your StormVPN protection.</p>
      </div>
      {params.get('suspended') ? (
        <Alert variant="destructive">
          <AlertCircle /> <span>Your account has been suspended. Contact support.</span>
        </Alert>
      ) : null}
      <FormError error={login.error} />
      <Field label="Email" htmlFor="email" error={fieldErrors.email}>
        <Input id="email" name="email" type="email" autoComplete="email" required autoFocus />
      </Field>
      <Field label="Password" htmlFor="password" error={fieldErrors.password}>
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </Field>
      <div className="flex justify-end text-sm">
        <Link href="/forgot-password" className="text-muted-foreground hover:text-foreground">
          Forgot password?
        </Link>
      </div>
      <Button type="submit" variant="brand" className="w-full" disabled={login.isPending}>
        {login.isPending ? <Spinner /> : null} Sign in
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        New to StormVPN?{' '}
        <Link href="/register" className="font-medium text-foreground hover:underline">
          Create an account
        </Link>
      </p>
    </form>
  );
}

export function RegisterForm() {
  const router = useRouter();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const register = useMutation({
    mutationFn: (input: Parameters<typeof api.auth.register>[0]) => api.auth.register(input),
    onSuccess: () => {
      router.replace('/dashboard?welcome=1');
      router.refresh();
    },
    onError: (error) => isApiError(error, 'validation_error') && setFieldErrors(error.fieldErrors),
  });
  return (
    <form
      className="space-y-5"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const values = formValues(event);
        const parsed = registerSchema.safeParse({ ...values, acceptTerms: values.acceptTerms === 'on', name: values.name || undefined });
        if (!parsed.success) {
          return setFieldErrors(Object.fromEntries(parsed.error.issues.map((issue) => [String(issue.path[0]), issue.message])));
        }
        setFieldErrors({});
        register.mutate(parsed.data);
      }}
    >
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">Create your account</h1>
        <p className="text-sm text-muted-foreground">Start free – upgrade anytime.</p>
      </div>
      <FormError error={register.error} />
      <Field label="Name (optional)" htmlFor="name" error={fieldErrors.name}>
        <Input id="name" name="name" autoComplete="name" />
      </Field>
      <Field label="Email" htmlFor="email" error={fieldErrors.email}>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </Field>
      <Field label="Password" htmlFor="password" error={fieldErrors.password} hint="At least 12 characters – a passphrase works great.">
        <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={12} />
      </Field>
      <label className="flex items-start gap-2 text-sm text-muted-foreground">
        <input type="checkbox" name="acceptTerms" className="mt-0.5 size-4 accent-[var(--primary)]" />
        <span>
          I accept the terms of service and acceptable use policy.
          {fieldErrors.acceptTerms ? <span className="block text-destructive">{fieldErrors.acceptTerms}</span> : null}
        </span>
      </label>
      <Button type="submit" variant="brand" className="w-full" disabled={register.isPending}>
        {register.isPending ? <Spinner /> : null} Create account
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{' '}
        <Link href="/login" className="font-medium text-foreground hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}

export function VerifyEmail() {
  const params = useSearchParams();
  const token = params.get('token');
  const [state, setState] = useState<'idle' | 'pending' | 'done' | 'error'>('idle');
  const [error, setError] = useState<unknown>(null);

  const verify = async () => {
    if (!token) return;
    setState('pending');
    try {
      await api.auth.verifyEmail(token);
      setState('done');
    } catch (caught) {
      setError(caught);
      setState('error');
    }
  };

  if (!token) return <p className="text-sm text-muted-foreground">This verification link is incomplete. Request a new email from your dashboard.</p>;
  return (
    <div className="space-y-5 text-center">
      {state === 'done' ? (
        <>
          <CheckCircle2 className="mx-auto size-10 text-status-good" />
          <h1 className="text-xl font-semibold">Email confirmed</h1>
          <p className="text-sm text-muted-foreground">Your account is active. Choose a plan and connect your first device.</p>
          <Button asChild variant="brand" className="w-full">
            <Link href="/dashboard">Go to dashboard</Link>
          </Button>
        </>
      ) : (
        <>
          <h1 className="text-xl font-semibold">Confirm your email</h1>
          <p className="text-sm text-muted-foreground">Click below to confirm your email address.</p>
          <FormError error={state === 'error' ? error : null} />
          <Button variant="brand" className="w-full" onClick={() => void verify()} disabled={state === 'pending'}>
            {state === 'pending' ? <Spinner /> : null} Confirm email
          </Button>
        </>
      )}
    </div>
  );
}

export function ForgotPasswordForm() {
  const request = useMutation({ mutationFn: (email: string) => api.auth.forgotPassword(email) });
  if (request.isSuccess) {
    return (
      <div className="space-y-3 text-center">
        <CheckCircle2 className="mx-auto size-10 text-status-good" />
        <h1 className="text-xl font-semibold">Check your inbox</h1>
        <p className="text-sm text-muted-foreground">If an account exists for this email, we sent a link to reset the password. It expires in 1 hour.</p>
      </div>
    );
  }
  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        request.mutate(formValues(event).email ?? '');
      }}
    >
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">Reset password</h1>
        <p className="text-sm text-muted-foreground">We will email you a secure reset link.</p>
      </div>
      <FormError error={request.error} />
      <Field label="Email" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </Field>
      <Button type="submit" className="w-full" disabled={request.isPending}>
        Send reset link
      </Button>
      <Link href="/login" className="block text-center text-sm text-muted-foreground hover:text-foreground">
        Back to sign in
      </Link>
    </form>
  );
}

export function ResetPasswordForm() {
  const params = useSearchParams();
  const token = params.get('token') ?? '';
  const [fieldError, setFieldError] = useState<string>();
  const reset = useMutation({ mutationFn: (password: string) => api.auth.resetPassword(token, password) });
  if (reset.isSuccess) {
    return (
      <div className="space-y-4 text-center">
        <CheckCircle2 className="mx-auto size-10 text-status-good" />
        <h1 className="text-xl font-semibold">Password updated</h1>
        <p className="text-sm text-muted-foreground">All sessions were signed out for your security.</p>
        <Button asChild className="w-full">
          <Link href="/login">Sign in</Link>
        </Button>
      </div>
    );
  }
  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        const { password, confirm } = formValues(event);
        const parsed = passwordSchema.safeParse(password);
        if (!parsed.success) return setFieldError(parsed.error.issues[0]!.message);
        if (password !== confirm) return setFieldError('Passwords do not match');
        setFieldError(undefined);
        reset.mutate(parsed.data);
      }}
    >
      <h1 className="text-xl font-semibold">Choose a new password</h1>
      <FormError error={reset.error} />
      <Field label="New password" htmlFor="password" error={fieldError}>
        <Input id="password" name="password" type="password" autoComplete="new-password" required />
      </Field>
      <Field label="Confirm password" htmlFor="confirm">
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
      </Field>
      <Button type="submit" className="w-full" disabled={reset.isPending || !token}>
        Update password
      </Button>
    </form>
  );
}
