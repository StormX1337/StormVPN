import type { UserDto } from '@stormvpn/types';
import { Alert, Button, Field, Input, Logo, Spinner } from '@stormvpn/ui';
import { AlertCircle } from 'lucide-react';
import { useState } from 'react';
import { type Api, errorMessage, storeTokens } from '../lib/api';
import { openExternal } from '../lib/open';

export function LoginScreen({
  api,
  apiUrl,
  onLoggedIn,
  onChangeServer,
}: {
  api: Api;
  apiUrl: string;
  onLoggedIn: (user: UserDto) => void;
  onChangeServer: () => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const result = mfaToken
        ? await api.auth.loginMfa(mfaToken, code.trim())
        : await api.auth.login({ email: email.trim(), password });
      if ('mfaRequired' in result) {
        setMfaToken(result.mfaToken);
        return;
      }
      if (!result.tokens) throw new Error('The server did not return a session');
      storeTokens(result.tokens);
      onLoggedIn(result.user);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full flex-col justify-center gap-8 p-8">
      <div className="flex flex-col items-center gap-2">
        <Logo />
        <p className="text-muted-foreground text-sm">{new URL(apiUrl).host}</p>
      </div>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {mfaToken ? (
          <Field
            label="Two-factor code"
            htmlFor="code"
            hint="Code from your authenticator app or a backup code."
          >
            <Input
              id="code"
              autoFocus
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          </Field>
        ) : (
          <>
            <Field label="Email" htmlFor="email">
              <Input
                id="email"
                type="email"
                autoFocus
                autoComplete="username"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </Field>
            <Field label="Password" htmlFor="password">
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </Field>
          </>
        )}
        {error ? (
          <Alert variant="destructive">
            <AlertCircle />
            <span>{error}</span>
          </Alert>
        ) : null}
        <Button type="submit" variant="brand" size="lg" disabled={busy}>
          {busy ? <Spinner /> : null}
          {mfaToken ? 'Verify' : 'Sign in'}
        </Button>
      </form>
      <div className="text-muted-foreground flex justify-between text-xs">
        <button
          type="button"
          className="hover:text-foreground"
          onClick={() => openExternal(`${apiUrl}/register`)}
        >
          Create account
        </button>
        <button type="button" className="hover:text-foreground" onClick={onChangeServer}>
          Change server address
        </button>
      </div>
    </div>
  );
}
