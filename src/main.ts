import { Notice, Plugin } from 'obsidian';
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
                                        this.startSyncUI();
                                        try {
                                                await importGoogleKeepNotesWithOptions(this, options);
                                                this.finishSyncUI(true);
                                        } catch (error) {
                                                this.finishSyncUI(false);
                                                new Notice('Failed to import Google Keep notes: ' + (error as Error).message);
                                        }
                                        resolve();
                                }
                        ).open();
                });
        }

        async importNotes() {
                const isSubscriptionActive = await this.subscriptionService.isSubscriptionActive();

                if (isSubscriptionActive) {
                        await this.showImportOptionsModal();
                        return;
                }

                this.startSyncUI();
                try {
                        await importGoogleKeepNotes(this);
                        this.finishSyncUI(true);
                } catch (error) {
                        this.finishSyncUI(false);
                        new Notice('Failed to import Google Keep notes: ' + (error as Error).message);
                }
        }

        startSyncUI() {
                this.processedNotes = 0;
                this.totalNotes = null;
                if (!this.statusBarItemEl) {
                        this.statusBarItemEl = this.addStatusBarItem();
                        this.statusBarItemEl.addEventListener('click', () => {
                                if (!this.progressModal) {
                                        this.progressModal = new SyncProgressModal(this.app, () => { this.progressModal = null; });
                                }
                                this.progressModal.setProgress(this.processedNotes, this.totalNotes ?? undefined);
                                this.progressModal.open();
                        });
                        this.statusBarItemEl.setAttribute('aria-label', 'KeepSidian sync progress');
                        this.statusBarItemEl.setAttribute('title', 'KeepSidian sync progress');

                        // Build a compact visual progress meter inside the status bar item
                        if ((this.statusBarItemEl as any).classList) {
                                this.statusBarItemEl.classList.add('keepsidian-status');
                        }

                        // Text label
                        this.statusTextEl = document.createElement('span');
                        this.statusTextEl.className = 'keepsidian-status-text';
                        this.statusTextEl.textContent = 'Sync: 0/?';
                        if ((this.statusBarItemEl as any).appendChild) {
                                this.statusBarItemEl.appendChild(this.statusTextEl);
                        } else if ((this.statusBarItemEl as any).setText) {
                                (this.statusBarItemEl as any).setText('Sync: 0/?');
                        }

                        // Progress container + animated bar (indeterminate)
                        this.progressContainerEl = document.createElement('div');
                        this.progressContainerEl.className = 'keepsidian-progress indeterminate';
                        this.progressBarEl = document.createElement('div');
                        this.progressBarEl.className = 'keepsidian-progress-bar';
                        this.progressContainerEl.appendChild(this.progressBarEl);
                        if ((this.statusBarItemEl as any).appendChild) {
                                this.statusBarItemEl.appendChild(this.progressContainerEl);
                        }
                } else {
                        // If already created, ensure elements exist and are reset
                        if (!this.statusTextEl) {
                                this.statusTextEl = document.createElement('span');
                                this.statusTextEl.className = 'keepsidian-status-text';
                                if ((this.statusBarItemEl as any).appendChild) {
                                        this.statusBarItemEl.appendChild(this.statusTextEl);
                                }
                        }
                        if (!this.progressContainerEl) {
                                this.progressContainerEl = document.createElement('div');
                                this.progressContainerEl.className = 'keepsidian-progress indeterminate';
                                this.progressBarEl = document.createElement('div');
                                this.progressBarEl.className = 'keepsidian-progress-bar';
                                this.progressContainerEl.appendChild(this.progressBarEl);
                                if ((this.statusBarItemEl as any).appendChild) {
                                        this.statusBarItemEl.appendChild(this.progressContainerEl);
                                }
                        }
                        // Reset progress visuals
                        this.progressContainerEl.style.display = '';
                        this.progressContainerEl.classList.remove('complete', 'failed');
                        this.progressContainerEl.classList.add('indeterminate');
                        if (this.progressBarEl) {
                                this.progressBarEl.classList.remove('paused');
                                this.progressBarEl.style.width = '';
                        }
                        this.statusTextEl.textContent = 'Sync: 0/?';
                }

                // Persistent notice while syncing
                this.progressNotice = new Notice('Syncing Google Keep Notes...', 0);
        }

        reportSyncProgress() {
                this.processedNotes += 1;
                const total = this.totalNotes ?? undefined;
                if (this.statusTextEl) {
                        this.statusTextEl.textContent = total
                                ? `Sync: ${this.processedNotes}/${total}`
                                : `Sync: ${this.processedNotes}`;
                } else if (this.statusBarItemEl && (this.statusBarItemEl as any).setText) {
                        (this.statusBarItemEl as any).setText(total
                                ? `Sync: ${this.processedNotes}/${total}`
                                : `Sync: ${this.processedNotes}`);
                }
                if (this.progressContainerEl && this.progressBarEl && typeof total === 'number' && total > 0) {
                        this.progressContainerEl.classList.remove('indeterminate');
                        const pct = Math.max(0, Math.min(100, Math.round((this.processedNotes / total) * 100)));
                        this.progressBarEl.style.width = pct + '%';
                }
                this.progressModal?.setProgress(this.processedNotes, total);
        }

        finishSyncUI(success: boolean) {
                if (this.progressNotice) {
                        const setter = (this.progressNotice as any).setMessage;
                        if (typeof setter === 'function') {
                                setter.call(this.progressNotice, success ? 'Synced Google Keep Notes.' : 'Failed to sync Google Keep Notes.');
                        }
                        if (success) {
                                const hider = (this.progressNotice as any).hide;
                                if (typeof hider === 'function') {
                                        setTimeout(() => hider.call(this.progressNotice), 4000);
                                }
                        }
                }
                const total = this.totalNotes ?? undefined;
                if (this.statusTextEl) {
                        this.statusTextEl.textContent = success
                                ? (typeof total === 'number' ? `Synced ${this.processedNotes}/${total} notes` : `Synced ${this.processedNotes} notes`)
                                : 'Sync failed';
                } else if (this.statusBarItemEl && (this.statusBarItemEl as any).setText) {
                        (this.statusBarItemEl as any).setText(success
                                ? (typeof total === 'number' ? `Synced ${this.processedNotes}/${total} notes` : `Synced ${this.processedNotes} notes`)
                                : 'Sync failed');
                }
                // Stop or hide the progress animation
                if (this.progressContainerEl) {
                        this.progressContainerEl.classList.toggle('complete', !!success);
                        this.progressContainerEl.classList.toggle('failed', !success);
                        // Keep the bar visible briefly; consumer can click to see details
                        setTimeout(() => {
                                if (this.progressContainerEl) {
                                        this.progressContainerEl.style.display = 'none';
                                }
                        }, 3000);
                }
                this.progressModal?.setComplete(success, this.processedNotes);
        }

        // Called by import flow when API reveals total number of notes
        setTotalNotes(total: number) {
                if (typeof total !== 'number' || total <= 0) return;
                this.totalNotes = total;
                // Update UI immediately
                if (this.statusTextEl) {
                        this.statusTextEl.textContent = `Sync: ${this.processedNotes}/${total}`;
                } else if (this.statusBarItemEl && (this.statusBarItemEl as any).setText) {
                        (this.statusBarItemEl as any).setText(`Sync: ${this.processedNotes}/${total}`);
                }
                if (this.progressContainerEl) {
                        this.progressContainerEl.classList.remove('indeterminate');
                }
                if (this.progressBarEl) {
                        const pct = Math.max(0, Math.min(100, Math.round((this.processedNotes / total) * 100)));
                        this.progressBarEl.style.width = pct + '%';
                }
                this.progressModal?.setProgress(this.processedNotes, total);
        }
}
