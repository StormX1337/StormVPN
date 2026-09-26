import path from 'node:path';
import type { NextConfig } from 'next';

const apiUrl = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';
const isDev = process.env.NODE_ENV !== 'production';

/** Content Security Policy – the app only talks to its own origin (API behind the same reverse proxy). */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self' ws: wss:${isDev ? ' http://localhost:4000' : ''}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

const nextConfig: NextConfig = {
  output: 'standalone',
  basePath: '/admin',
  outputFileTracingRoot: path.resolve(process.cwd(), '../..'),
  transpilePackages: ['@stormvpn/ui'],
  poweredByHeader: false,
  reactStrictMode: true,
  async rewrites() {
    // Development convenience: in production nginx routes /api directly to the API.
    return [{ source: '/api/:path*', destination: `${apiUrl}/api/:path*`, basePath: false }];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
