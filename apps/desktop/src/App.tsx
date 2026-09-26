import type { UserDto } from '@stormvpn/types';
import { Spinner } from '@stormvpn/ui';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { clearSession, createClient, restoreSession } from './lib/api';
import { settings } from './lib/settings';
import { LoginScreen } from './screens/login-screen';
import { MainScreen } from './screens/main-screen';
import { SetupScreen } from './screens/setup-screen';

type View =
  { name: 'loading' } | { name: 'setup' } | { name: 'login' } | { name: 'main'; user: UserDto };

export function App() {
  const [apiUrl, setApiUrl] = useState<string | null>(() => settings.apiUrl());
  const [view, setView] = useState<View>({ name: 'loading' });

  const api = useMemo(
    () => (apiUrl ? createClient(apiUrl, () => setView({ name: 'login' })) : null),
    [apiUrl],
  );

  useEffect(() => {
    if (!api) {
      setView({ name: 'setup' });
      return;
    }
    let cancelled = false;
    void (async () => {
      const hasSession = await restoreSession();
      if (!hasSession) {
        if (!cancelled) setView({ name: 'login' });
        return;
      }
      try {
        const user = await api.user.me();
        if (!cancelled) setView({ name: 'main', user });
      } catch {
        if (!cancelled) setView({ name: 'login' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api]);

  const changeServer = useCallback(() => {
    clearSession();
    setApiUrl(null);
    setView({ name: 'setup' });
  }, []);

  if (view.name === 'setup' || !api || !apiUrl) {
    return (
      <SetupScreen
        initialUrl={apiUrl ?? ''}
        onSaved={(url) => {
          settings.setApiUrl(url);
          setApiUrl(url);
          setView({ name: 'loading' });
        }}
      />
    );
  }
  if (view.name === 'loading') {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="size-6" />
      </div>
    );
  }
  if (view.name === 'login') {
    return (
      <LoginScreen
        api={api}
        apiUrl={apiUrl}
        onLoggedIn={(user) => setView({ name: 'main', user })}
        onChangeServer={changeServer}
      />
    );
  }
  return (
    <MainScreen
      api={api}
      apiUrl={apiUrl}
      user={view.user}
      onLoggedOut={() => setView({ name: 'login' })}
    />
  );
}
