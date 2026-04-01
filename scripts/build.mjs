import { rmSync } from 'node:fs';

import { build } from 'esbuild';

const entryPoints = [
  'src/services/index.ts',
  'src/cli/index.ts',
  'src/mcp/index.ts',
];

rmSync('dist', { recursive: true, force: true });

await build({
  entryPoints,
  outdir: 'dist',
  outbase: 'src',
  bundle: true,
  minify: true,
  format: 'cjs',
  platform: 'node',
  target: 'node22',
  legalComments: 'none',
  logLevel: 'info',
  packages: 'bundle',
  treeShaking: true,
  outExtension: {
    '.js': '.cjs',
  },
});
