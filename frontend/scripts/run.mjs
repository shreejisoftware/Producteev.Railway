import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const mode = process.argv[2] || 'dev';
const viteBin = path.resolve(fileURLToPath(new URL('../..', import.meta.url)), 'node_modules', 'vite', 'bin', 'vite.js');
const isProduction =
  mode === 'start' ||
  process.env.NODE_ENV === 'production' ||
  process.env.npm_config_production === 'true' ||
  Boolean(process.env.RAILWAY_ENVIRONMENT);

const args = isProduction
  ? [viteBin, 'preview', '--host', '0.0.0.0', '--port', String(process.env.PORT || 4173)]
  : [viteBin];

const child = spawn(process.execPath, args, {
  stdio: 'inherit',
  env: process.env,
});

child.on('exit', (code) => {
  process.exit(code ?? 0);
});