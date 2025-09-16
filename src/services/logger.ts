import type { AppLike } from './paths';
import { ensureParentFolderForFile } from './paths';

export async function appendLog(app: AppLike, logPath: string, line: string): Promise<void> {
  try {
    if (!app || !(app as any).vault || !(app as any).vault.adapter) {
      return;
    }
    // Ensure the parent folder exists so write does not fail due to missing directory
    await ensureParentFolderForFile(app, logPath);
    let existing = '';
    if (await (app as any).vault.adapter.exists(logPath)) {
      existing = await (app as any).vault.adapter.read(logPath);
    }
    await (app as any).vault.adapter.write(logPath, `${existing}${line}`);
  } catch (e) {
    try {
      const isTest = typeof process !== 'undefined' && (process.env?.NODE_ENV === 'test' || !!process.env?.JEST_WORKER_ID);
      if (!isTest) {
        console.error('Failed to append log:', e);
      }
    } catch {}
    throw e;
  }
}
