import { normalizePath } from 'obsidian';
import type KeepSidianPlugin from '../main';

export async function logSync(plugin: KeepSidianPlugin, message: string) {
  try {
    const logPath = normalizePath(`${plugin.settings.saveLocation}/${plugin.settings.syncLogPath}`);
    let existing = '';
    if (await plugin.app.vault.adapter.exists(logPath)) {
      existing = await plugin.app.vault.adapter.read(logPath);
    }
    const timestamp = new Date().toISOString();
    await plugin.app.vault.adapter.write(logPath, `${existing}[${timestamp}] ${message}\n`);
  } catch (e) {
    console.error('Failed to write sync log:', e);
  }
}

