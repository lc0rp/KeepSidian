import { Notice, Plugin, normalizePath } from 'obsidian';
import { importGoogleKeepNotes, importGoogleKeepNotesWithOptions } from './google/keep/import';
import { KeepSidianPluginSettings, DEFAULT_SETTINGS } from './types/keepsidian-plugin-settings';
import { KeepSidianSettingsTab } from './components/KeepSidianSettingsTab';
import { SubscriptionService } from './services/subscription';
import { NoteImportOptions, NoteImportOptionsModal } from './components/NoteImportOptionsModal';

export default class KeepSidianPlugin extends Plugin {
        settings: KeepSidianPluginSettings;
        subscriptionService: SubscriptionService;
        private autoSyncInterval?: number;

	async onload() {
		await this.loadSettings();

		this.subscriptionService = new SubscriptionService(
				() => this.settings.email,
				() => this.settings.subscriptionCache,
				async (cache) => {
					this.settings.subscriptionCache = cache;
					await this.saveSettings();
				}
		);

		this.initializeRibbonIcon();
		this.initializeCommands();
                this.initializeSettings();

                if (this.settings.autoSyncEnabled) {
                        this.startAutoSync();
                }
        }

	private initializeRibbonIcon() {
		this.addRibbonIcon('folder-sync', 'Import Google Keep notes.', (evt: MouseEvent) => {
			this.importNotes();
		});
	}

        private initializeCommands() {
                this.addCommand({
                        id: 'import-google-keep-notes',
                        name: 'Import Google Keep Notes',
                        callback: async () => await this.importNotes()
                });
        }

	private initializeSettings() {
		this.addSettingTab(new KeepSidianSettingsTab(this.app, this));
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

        async showImportOptionsModal(): Promise<void> {
                return new Promise((resolve) => {
                        new NoteImportOptionsModal(
                                this.app,
                                this,
                                async (options: NoteImportOptions) => {
                                        const count = await importGoogleKeepNotesWithOptions(this, options);
                                        await this.logSync(`Manual sync successful: ${count} notes`);
                                        resolve();
                                }
                        ).open();
                });
        }

        async importNotes(auto = false) {
                try {
                        const isSubscriptionActive = await this.subscriptionService.isSubscriptionActive();

                        if (!auto && isSubscriptionActive) {
                                await this.showImportOptionsModal();
                        } else {
                                const count = await importGoogleKeepNotes(this);
                                await this.logSync(`${auto ? 'Auto' : 'Manual'} sync successful: ${count} notes`);
                        }
                } catch (error) {
                        await this.logSync(`${auto ? 'Auto' : 'Manual'} sync failed: ${error.message}`);
                }
        }

        startAutoSync() {
                this.stopAutoSync();
                const intervalMs = this.settings.autoSyncIntervalHours * 60 * 60 * 1000;
                this.autoSyncInterval = window.setInterval(() => {
                        this.importNotes(true);
                }, intervalMs);
                this.registerInterval(this.autoSyncInterval);
        }

        stopAutoSync() {
                if (this.autoSyncInterval) {
                        window.clearInterval(this.autoSyncInterval);
                        this.autoSyncInterval = undefined;
                }
        }

        private async logSync(message: string) {
                try {
                        const logPath = normalizePath(`${this.settings.saveLocation}/${this.settings.syncLogPath}`);
                        let existing = '';
                        if (await this.app.vault.adapter.exists(logPath)) {
                                existing = await this.app.vault.adapter.read(logPath);
                        }
                        const timestamp = new Date().toISOString();
                        await this.app.vault.adapter.write(logPath, `${existing}[${timestamp}] ${message}\n`);
                } catch (e) {
                        console.error('Failed to write sync log:', e);
                }
        }
}