import { App, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';
import { handleDuplicateNotes } from './compare/compare';
import { normalizeNote } from './note/note';
import PCR from 'puppeteer-chromium-resolver';
import { chromium } from 'playwright';
import { normalizePath } from "obsidian";

const API_URL = 'http://localhost:8080';

interface KeepToObsidianPluginSettings {
	email: string;
	token: string;
	saveLocation: string;
}

const DEFAULT_SETTINGS: KeepToObsidianPluginSettings = {
	email: '',
	token: '',
	saveLocation: 'KeepSidian'
}

export default class KeepToObsidianPlugin extends Plugin {
	settings: KeepToObsidianPluginSettings;

	async onload() {
		await this.loadSettings();

		// This creates an icon in the left ribbon.
		const ribbonIconEl = this.addRibbonIcon('folder-sync', 'Run Google Keep → Obsidian', (evt: MouseEvent) => {
			// Called when the user clicks the icon.
			this.syncNotes();
			new Notice('Synced Google Keep Notes to Obsidian');
		});
		// Perform additional things with the ribbon
		ribbonIconEl.addClass('KeepSidian-ribbon-class');

		// This adds a command to sync notes
		this.addCommand({
			id: 'sync-notes',
			name: 'Run Google Keep → Obsidian',
			callback: () => {
				this.syncNotes();
			}
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new KeepToObsidianSettingTab(this.app, this));
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async syncNotes() {
		try {
			const response = await fetch(`${API_URL}/sync`, {
				method: 'GET',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${this.settings.token}`
				}
			});

			if (!response.ok) {
				throw new Error('Failed to sync notes');
			}

			const result = await response.json();
			const notes = result.notes;
			const saveLocation = this.settings.saveLocation;
			// Create saveLocation if it doesn't exist
			if (!(await this.app.vault.adapter.exists(saveLocation))) {
				await this.app.vault.createFolder(saveLocation);
			}

			// Create media subfolder if it doesn't exist
			const mediaFolder = `${saveLocation}/media`;
			if (!(await this.app.vault.adapter.exists(mediaFolder))) {
				await this.app.vault.createFolder(mediaFolder);
			}

			for (const note of notes) {
				const normalizedNote = normalizeNote(note);
				const noteTitle = normalizedNote.title;
				let noteFilePath = normalizePath(`${saveLocation}/${noteTitle}.md`);

				const lastSyncedDate = new Date().toISOString();

				// Check if the note file already exists
				const duplicateNotesAction = await handleDuplicateNotes(noteFilePath, normalizedNote, this.app);
				if (duplicateNotesAction === 'skip') {
					continue;
				} else if (duplicateNotesAction === 'rename') {
					noteFilePath = noteFilePath.replace(/\.md$/, '');
					noteFilePath = `${noteFilePath}-conflict-${lastSyncedDate}.md`;
				}
				
				// Save the note content to a markdown file
				// Add syncDate to the frontmatter, which may already exist or not
				const mdFrontMatterDict = normalizedNote.frontmatterDict;
				mdFrontMatterDict.KeepSidianLastSyncedDate = lastSyncedDate;
				const mdFrontMatter = Object.entries(mdFrontMatterDict).map(([key, value]) => `${key}: ${value}`).join('\n');
				const mdContentWithSyncDate = `---\n${mdFrontMatter}\n---\n${normalizedNote.body}`;

				await this.app.vault.adapter.write(noteFilePath, mdContentWithSyncDate);

				// Download and save each blob_url
				for (const blob_url of note.blob_urls) {
					const blobResponse = await fetch(blob_url);
					if (!blobResponse.ok) {
						throw new Error(`Failed to download blob from ${blob_url}`);
					}
					const blobData = await blobResponse.arrayBuffer();
					const blobFileName = blob_url.split('/').pop();
					const blobFilePath = `${saveLocation}/media/${blobFileName}`;
					await this.app.vault.adapter.writeBinary(blobFilePath, blobData);
				}
			}
			new Notice('Notes synced successfully');
		} catch (error) {
			console.error(error);
			new Notice('Failed to sync notes');
		}
	}

	async retrieveToken() {
		try {
			const oauthToken = await this.getOAuthToken();
			const response = await fetch(`${API_URL}/register`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					email: this.settings.email,
					oauth_token: oauthToken,
				}),
			});

			if (!response.ok) {
				throw new Error('Failed to retrieve token');
			}

			const result = await response.json();
			this.settings.token = result.keep_token;
			await this.saveSettings();
			new Notice('Token retrieved successfully');
		} catch (error) {
			console.error(error);
			new Notice('Failed to retrieve token');
		}
	}

	async getOAuthToken(): Promise<string> {
		const OAUTH_URL = "https://accounts.google.com/EmbeddedSetup";
		const GOOGLE_EMAIL = this.settings.email;

		const createOverlayScript = (message: string): string => {
			return `
			(function() {
				let overlay = document.getElementById('oauth-guide-overlay');
				if (!overlay) {
					overlay = document.createElement('div');
					overlay.id = 'oauth-guide-overlay';
					overlay.style.position = 'fixed';
					overlay.style.top = '10px';
					overlay.style.right = '10px';
					overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
					overlay.style.color = 'white';
					overlay.style.padding = '20px';
					overlay.style.borderRadius = '5px';
					overlay.style.zIndex = '10000';
					document.body.appendChild(overlay);
				}
				overlay.textContent = '${message}';
			})();
			`;
		};
		const options = {};
		const stats = await PCR(options);

		return new Promise<string>((resolve, reject) => {
			(async()=> {
				try {
					const browser = await chromium.launch({ headless: false, executablePath: stats.executablePath });
					const context = await browser.newContext();
					const page = await context.newPage();

					await page.goto(OAUTH_URL);

					let oauthToken: string | null = null;
					const startTime = Date.now();
					const timeout = 300000; // 5 minutes timeout

					let emailEntered = false;
					while (!oauthToken && (Date.now() - startTime) < timeout) {
						const currentUrl = page.url();

						if (currentUrl.includes("accounts.google.com")) {
							await page.evaluate(createOverlayScript("Step 1/3: Log in with your Google account."));
							if (!emailEntered) {
								const emailInput = await page.$('input[type="email"]');
								if (emailInput) {
									await emailInput.type(GOOGLE_EMAIL);
									emailEntered = true;
								}
							}
						}

						if (currentUrl.includes("embeddedsigninconsent")) {
							await page.evaluate(createOverlayScript("Step 2/3: Review and Agree to terms."));
						}

						const cookies = await context.cookies();
						for (const cookie of cookies) {
							if (cookie.name === "oauth_token") {
								oauthToken = cookie.value;
								// console.log(`OAuth Token found in cookie: ${oauthToken}`);
								await page.evaluate(createOverlayScript("Step 3/3: OAuth token successfully! Closing browser..."));
								break;
							}
						}

						// Wait for 1 seconds
						await page.waitForTimeout(1000);
					}

					if (!oauthToken) {
						// console.log("Timeout: OAuth token not obtained within the specified time.");
						await page.evaluate(createOverlayScript("Timeout: OAuth token not obtained. Please try again."));
						reject(new Error("OAuth token not obtained"));
					} else {
						resolve(oauthToken);
					}

					await page.waitForTimeout(3000);
					await browser.close();
				} catch (error) {
					console.error(error);
					reject(error);
				}
			})();
		});
	}
}

class KeepToObsidianSettingTab extends PluginSettingTab {
	plugin: KeepToObsidianPlugin;

	constructor(app: App, plugin: KeepToObsidianPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	// Add a helper method to validate email
	private isValidEmail(email: string): boolean {
		const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
		return emailRegex.test(email);
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('Email')
			.setDesc('Your Google Keep email.')
			.addText(text => text
				.setPlaceholder('example@gmail.com')
				.setValue(this.plugin.settings.email)
				.onChange(async (value) => {
					this.plugin.settings.email = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Sync token')
			.setDesc('Your Google Keep sync token (Only stored on your computer).')
			.addText(text => text
				.setPlaceholder('Your Google Keep sync token.')
				.setValue(this.plugin.settings.token)
				.setDisabled(true))
			.addButton(button => button
				.setButtonText('Retrieve Token')
				.onClick(async () => {
					if (!this.plugin.settings.email || !this.isValidEmail(this.plugin.settings.email)) {
						new Notice('Please enter a valid email address before retrieving the token.');
						return;
					}
					await this.plugin.retrieveToken();
					this.display(); // Refresh the settings page
				}));

		new Setting(containerEl)
			.setName('Save location')
			.setDesc('Where to save synced notes (relative to vault folder).')
			.addText(text => text
				.setPlaceholder('KeepSidian')
				.setValue(this.plugin.settings.saveLocation)
				.onChange(async (value) => {
					this.plugin.settings.saveLocation = value;
					await this.plugin.saveSettings();
				}));
	}
}
