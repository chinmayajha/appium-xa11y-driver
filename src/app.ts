import { App } from '@crowecawcaw/xa11y';

export async function attach(target: { pid?: number; name?: string }, timeoutMs: number): Promise<App> {
  if (target.pid) {
    return App.byPid(target.pid, { timeout: timeoutMs });
  }
  if (target.name) {
    return App.byName(target.name, { timeout: timeoutMs });
  }
  return App.foreground({ timeout: timeoutMs });
}

export function terminate(pid: number): void {
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    return;
  }
}
