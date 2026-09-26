import { Alert, Button, Field, Input, Logo } from '@stormvpn/ui';
import { AlertCircle } from 'lucide-react';
import { useState } from 'react';
import { normalizeApiUrl } from '../lib/settings';

/** First start: which StormVPN installation to use (e.g. vpn.example.com). */
export function SetupScreen({
  initialUrl,
  onSaved,
}: {
  initialUrl: string;
  onSaved: (url: string) => void;
}) {
  const [value, setValue] = useState(initialUrl);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex h-full flex-col justify-center gap-8 p-8">
      <Logo className="mx-auto" />
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          try {
            onSaved(normalizeApiUrl(value));
          } catch {
            setError('Please enter a valid address, e.g. vpn.example.com');
          }
        }}
      >
        <Field
          label="Server address"
          htmlFor="api-url"
          hint="The address of your StormVPN website."
        >
          <Input
            id="api-url"
            autoFocus
            placeholder="vpn.example.com"
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        </Field>
        {error ? (
          <Alert variant="destructive">
            <AlertCircle />
            <span>{error}</span>
          </Alert>
        ) : null}
        <Button type="submit" variant="brand" size="lg" disabled={!value.trim()}>
          Continue
        </Button>
      </form>
    </div>
  );
}
