import type KeepSidianPlugin from '../main';

export function registerRibbonIcon(plugin: KeepSidianPlugin) {
  plugin.addRibbonIcon(
    'folder-sync',
    'Import Google Keep notes.',
    (_evt: MouseEvent) => {
      plugin.importNotes();
    }
  );
}

export function registerCommands(plugin: KeepSidianPlugin) {
  plugin.addCommand({
    id: 'import-google-keep-notes',
    name: 'Import Google Keep Notes',
    callback: async () => await plugin.importNotes(),
  });
}

export function registerRibbonAndCommands(plugin: KeepSidianPlugin) {
  registerRibbonIcon(plugin);
  registerCommands(plugin);
}

