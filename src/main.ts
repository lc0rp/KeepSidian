import { Notice, Plugin, normalizePath } from 'obsidian';
import { importGoogleKeepNotes, importGoogleKeepNotesWithOptions } from './google/keep/import';
import { KeepSidianPluginSettings, DEFAULT_SETTINGS } from './types/keepsidian-plugin-settings';
import { KeepSidianSettingsTab } from './components/KeepSidianSettingsTab';
import { SubscriptionService } from './services/subscription';
import { NoteImportOptions, NoteImportOptionsModal } from './components/NoteImportOptionsModal';
import { SyncProgressModal } from './components/SyncProgressModal';

export default class KeepSidianPlugin extends Plugin {
	settings: KeepSidianPluginSettings;
	subscriptionService: SubscriptionService;
	statusBarItemEl: HTMLElement | null = null;
	// Elements for visual status in the status bar
	statusTextEl: HTMLSpanElement | null = null;
	progressContainerEl: HTMLDivElement | null = null;
	progressBarEl: HTMLDivElement | null = null;
	progressModal: SyncProgressModal | null = null;
	progressNotice: Notice | null = null;
	processedNotes = 0;
	totalNotes: number | null = null;
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
		this.addRibbonIcon(
			"folder-sync",
			"Import Google Keep notes.",
			(evt: MouseEvent) => {
				this.importNotes();
			}
		);
	}

	private initializeCommands() {
		this.addCommand({
			id: "import-google-keep-notes",
			name: "Import Google Keep Notes",
			callback: async () => await this.importNotes(),
		});
	}

	private initializeSettings() {
		this.addSettingTab(new KeepSidianSettingsTab(this.app, this));
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
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
					await importGoogleKeepNotesWithOptions(this, options);
					new Notice("Imported Google Keep notes.");
					resolve();
				}
			).open();
		});
	}

	async importNotes() {
		try {
			const isSubscriptionActive =
				await this.subscriptionService.isSubscriptionActive();

			if (isSubscriptionActive) {
				await this.showImportOptionsModal();
			} else {
				await importGoogleKeepNotes(this);
				new Notice("Imported Google Keep notes.");
			}
		} catch (error) {
			new Notice("Failed to import Google Keep notes: " + error.message);
		}
	}
}