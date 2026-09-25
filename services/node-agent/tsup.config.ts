import { defineConfig } from 'tsup';

/**
 * The agent ships as a single self-contained ESM file (all dependencies
 * bundled) so a VPN node only needs Node.js 22 + wireguard-tools.
 */
export default defineConfig({
  entry: { 'stormvpn-agent': 'src/main.ts' },
  format: ['esm'],
  outExtension: () => ({ js: '.mjs' }),
  platform: 'node',
  target: 'node22',
  sourcemap: false,
  clean: true,
  dts: false,
  noExternal: [/.*/],
  banner: {
    js: "#!/usr/bin/env node\nimport { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
});
