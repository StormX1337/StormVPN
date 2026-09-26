'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { ThemeProvider as NextThemesProvider, useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import type * as React from 'react';
import { Toaster as SonnerToaster } from 'sonner';
import { Button } from './button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './dropdown-menu';
import { TooltipProvider } from './tooltip';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem
      disableTransitionOnChange
    >
      <TooltipProvider>{children}</TooltipProvider>
    </NextThemesProvider>
  );
}

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const Icon = !mounted ? Moon : theme === 'light' ? Sun : theme === 'system' ? Monitor : Moon;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Change theme">
          <Icon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => setTheme('light')}>
          <Sun /> Light
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setTheme('dark')}>
          <Moon /> Dark
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setTheme('system')}>
          <Monitor /> System
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Toaster() {
  const { resolvedTheme } = useTheme();
  return (
    <SonnerToaster
      theme={resolvedTheme === 'light' ? 'light' : 'dark'}
      richColors
      closeButton
      position="top-right"
    />
  );
}

export { toast } from 'sonner';
