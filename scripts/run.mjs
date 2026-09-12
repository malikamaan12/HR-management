import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
if (existsSync('.env')) loadEnvFile('.env');
const production = process.argv[2] === 'production';
const child = spawn(process.execPath, production ? ['dist/index.js'] : ['--import', 'tsx', 'server/index.ts'], {
  stdio: 'inherit', env: { ...process.env, NODE_ENV: production ? 'production' : 'development' },
});
child.on('exit', code => process.exit(code ?? 1));
child.on('error', error => { console.error(error.message); process.exit(1); });
