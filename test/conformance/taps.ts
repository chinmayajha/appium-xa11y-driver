import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';

const SOURCE = path.resolve(__dirname, '../../../test/conformance/mac/taps.swift');

/** The fixture program, built once; CI builds it before the run to grant it Accessibility. */
export const TAP_FIXTURE = process.env.TAP_FIXTURE ?? path.join(tmpdir(), 'appium-xa11y-taps');

export interface HeldTap {
  /** Removes the tap and gives the times the OS turned it off, which make the hold not what the test asked for. */
  stop(): Promise<number>;
}

/** Installs a filtering tap of the fixture on this machine and returns when it is enabled. */
export async function holdTap(args: string[]): Promise<HeldTap> {
  if (!existsSync(TAP_FIXTURE)) {
    execFileSync('swiftc', ['-O', SOURCE, '-o', TAP_FIXTURE]);
  }
  const child = spawn(TAP_FIXTURE, ['hold', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d; });
  const exited = new Promise<number | null>((resolve) => child.on('exit', resolve));
  const ready = new Promise<void>((resolve) => {
    createInterface({ input: child.stdout }).on('line', (line) => line.startsWith('ready') && resolve());
  });
  if (await Promise.race([ready.then(() => true), exited.then(() => false)]) === false) {
    throw new Error(`The fixture tap did not start: ${stderr.trim()}`);
  }
  return {
    async stop() {
      child.kill('SIGTERM');
      await exited;
      return stderr.split('\n').filter((l) => l.startsWith('re-enabled')).length;
    },
  };
}

/** Whether the tests run on the Host, where a fixture tap reaches the input of the Session. */
export function onHost(url: string): boolean {
  return ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname);
}
