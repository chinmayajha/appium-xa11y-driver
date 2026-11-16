#!/usr/bin/env node
// Usage: node scripts/xa11y-loaded.mjs <driver dir> <built xa11y-js dir>
// Appium links the driver to the checkout, so the driver loads xa11y as Node resolves it from there.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const [driver, built] = process.argv.slice(2);
const require = createRequire(path.join(driver, 'package.json'));
const pkg = require.resolve('@crowecawcaw/xa11y/package.json');
require('@crowecawcaw/xa11y');
const loaded = Object.keys(require.cache).find((f) => f.endsWith('.node'));
const want = readdirSync(built).find((f) => f.endsWith('.node'));
if (!want) {
  console.error(`${built} holds no native binary`);
  process.exit(1);
}
const hash = (f) => createHash('sha256').update(readFileSync(f)).digest('hex');
console.log(`driver loads @crowecawcaw/xa11y ${require(pkg).version}, native binary ${loaded}`);
if (!loaded || hash(loaded) !== hash(path.join(built, want))) {
  console.error(`the driver does not load ${path.join(built, want)}`);
  process.exit(1);
}
console.log(`sha256 ${hash(loaded)} is the build of the ref`);
