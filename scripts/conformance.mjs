#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { url: { type: 'string', default: 'http://127.0.0.1:4723' }, os: { type: 'string' } } });
const os = values.os ?? { darwin: 'mac', win32: 'windows' }[process.platform] ?? 'linux';
const dir = fileURLToPath(new URL('../build/test/conformance/', import.meta.url));
const files = readdirSync(dir).filter((f) => f.endsWith('.test.js')).map((f) => dir + f);
const run = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...files], {
  stdio: 'inherit',
  env: { ...process.env, CONFORMANCE_URL: values.url, CONFORMANCE_OS: os },
});
process.exit(run.status ?? 1);
