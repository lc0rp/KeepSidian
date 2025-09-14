import type KeepSidianPlugin from '@app/main';
import { appendLog } from '../services/logger';
import { normalizePathSafe } from '../services/paths';

export async function logSync(plugin: KeepSidianPlugin, message: string) {
  try {
    const logPath = normalizePathSafe(`${plugin.settings.saveLocation}/${plugin.settings.syncLogPath}`);
    const timestamp = new Date().toISOString();
    await appendLog(plugin.app as any, logPath, `[${timestamp}] ${message}\n`);
  } catch (e) {
    try {
      const isTest = typeof process !== 'undefined' && (process.env?.NODE_ENV === 'test' || !!process.env?.JEST_WORKER_ID);
      if (!isTest) {
        console.error('Failed to write sync log:', e);
      }
    } catch {}
  }
}
