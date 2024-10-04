import { Notice, Plugin } from 'obsidian';
import { importGoogleKeepNotes } from './google/keep/import';
import { KeepSidianSettingTab, KeepSidianPluginSettings, DEFAULT_SETTINGS } from './settings';

export default class KeepSidianPlugin extends Plugin {
	settings: KeepSidianPluginSettings;

	async onload() {
		await this.loadSettings();

		// This creates an icon in the left ribbon.
		this.addRibbonIcon('folder-sync', 'Import Google Keep notes.', (evt: MouseEvent) => {
			// Called when the user clicks the icon.
			importGoogleKeepNotes(this);
			new Notice('Imported Google Keep notes.');
		});

		// This adds a command to sync notes
		this.addCommand({
			id: 'import-google-keep-notes',
			name: 'Import Google Keep notes.',
			callback: () => {
				importGoogleKeepNotes(this);
			}
		});

		// This adds a command to sync Google Drive files
		/* this.addCommand({
			id: 'import-gdrive-files',
			name: 'Import Google Drive files',
			callback: () => {
				importGoogleDriveFiles(this);
			}
		}); */
		
		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new KeepSidianSettingTab(this.app, this));
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}