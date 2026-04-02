/*
 1. esbuild 先打单文件 bundle
 2. minify 压缩代码
 3. javascript-obfuscator 做一层中等强度混淆
*/
import { readFile, rm, writeFile } from 'node:fs/promises';

import { build } from 'esbuild';
import JavaScriptObfuscator from 'javascript-obfuscator';

const entryPoints = ['src/cli/index.ts', 'src/mcp/index.ts'];
const buildMode = process.argv[2] === 'dev' ? 'dev' : 'release';
const shouldObfuscate =
  process.env.BUILD_OBFUSCATE === '0' ? false : buildMode === 'release';
const outputFiles = entryPoints.map(entryPoint =>
  entryPoint.replace(/^src\//, 'dist/').replace(/\.ts$/, '.cjs'),
);

await rm('dist', { recursive: true, force: true });

console.log(`Build mode: ${buildMode}`);

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

if (shouldObfuscate) {
  for (const outputFile of outputFiles) {
    const source = await readFile(outputFile, 'utf8');
    const result = JavaScriptObfuscator.obfuscate(source, {
      compact: true,
      controlFlowFlattening: false,
      deadCodeInjection: false,
      identifierNamesGenerator: 'hexadecimal',
      numbersToExpressions: true,
      renameGlobals: false,
      renameProperties: false,
      selfDefending: false,
      simplify: true,
      splitStrings: false,
      stringArray: true,
      stringArrayCallsTransform: true,
      stringArrayEncoding: ['base64'],
      stringArrayIndexShift: true,
      stringArrayRotate: true,
      stringArrayShuffle: true,
      stringArrayThreshold: 0.85,
      target: 'node',
      transformObjectKeys: false,
      unicodeEscapeSequence: false,
    });

    await writeFile(outputFile, result.getObfuscatedCode(), 'utf8');
  }

  console.log('Obfuscation complete.');
} else {
  console.log(
    buildMode === 'dev'
      ? 'Obfuscation skipped in dev mode.'
      : 'Obfuscation skipped because BUILD_OBFUSCATE=0.',
  );
}
