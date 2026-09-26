'use client';

import { useEffect, useState } from 'react';

const TOKENS = [
  '--chart-1',
  '--chart-2',
  '--chart-grid',
  '--chart-axis',
  '--chart-surface',
  '--foreground',
  '--muted-foreground',
] as const;
export type ChartToken = (typeof TOKENS)[number];

function read(): Record<ChartToken, string> {
  const style = getComputedStyle(document.documentElement);
  return Object.fromEntries(
    TOKENS.map((token) => [token, style.getPropertyValue(token).trim()]),
  ) as Record<ChartToken, string>;
}

/**
 * Resolves chart tokens to concrete colors (SVG attributes cannot use CSS
 * variables reliably) and re-reads them when the theme class changes.
 */
export function useChartColors(): Record<ChartToken, string> | null {
  const [colors, setColors] = useState<Record<ChartToken, string> | null>(null);
  useEffect(() => {
    setColors(read());
    const observer = new MutationObserver(() => setColors(read()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'style', 'data-theme'],
    });
    return () => observer.disconnect();
  }, []);
  return colors;
}
