import type KeepSidianPlugin from '@app/main';

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

  plugin.addCommand({
    id: 'push-google-keep-notes',
    name: 'Push Notes to Google Keep',
    callback: async () => await plugin.pushNotes(),
  });

  plugin.addCommand({
    id: 'two-way-sync-google-keep',
    name: 'Perform Two-Way Sync',
    callback: async () => await plugin.performTwoWaySync(),
  });
}

export function registerRibbonAndCommands(plugin: KeepSidianPlugin) {
  registerRibbonIcon(plugin);
  registerCommands(plugin);
}
