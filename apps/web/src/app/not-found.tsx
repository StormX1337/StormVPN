import { Button, Logo } from '@stormvpn/ui';
import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="hero-glow flex min-h-dvh flex-col items-center justify-center gap-6 px-4 text-center">
      <Logo />
      <h1 className="text-5xl font-semibold">404</h1>
      <p className="text-muted-foreground">This page drifted off in the storm.</p>
      <Button asChild>
        <Link href="/">Back home</Link>
      </Button>
    </div>
  );
}
