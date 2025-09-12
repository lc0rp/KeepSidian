import { SubscriptionSettingsTab } from "./SubscriptionSettingsTab";
import { WebviewTag } from "electron";
import { exchangeOauthToken, initRetrieveToken } from "../google/keep/token";
import KeepSidianPlugin from "main";
import { PluginSettingTab, App, Setting, Notice } from "obsidian";

export class KeepSidianSettingsTab extends PluginSettingTab {
	private retrieveTokenWebView: WebviewTag;
	private plugin: KeepSidianPlugin;

	constructor(app: App, plugin: KeepSidianPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	private isValidEmail(email: string): boolean {
		const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
		return emailRegex.test(email);
	}

	async display(): Promise<void> {
		const { containerEl } = this;
		containerEl.empty();

		// Basic settings
		containerEl.createEl('h3', { text: 'KeepSidian Settings' });

                this.addEmailSetting(containerEl);
                this.addSaveLocationSetting(containerEl);
                await this.addAutoSyncSettings(containerEl);
		
		// Sync Token section
		containerEl.createEl('h3', { text: 'Sync Token Settings' });
		this.addSyncTokenSetting(containerEl);
		
		this.createRetrieveTokenWebView(containerEl);
		this.addSubscriptionSettings(containerEl);
	}

	private addSubscriptionSettings(containerEl: HTMLElement): void {
		const subscriptionTab = new SubscriptionSettingsTab(
			containerEl,
			this.plugin
		);
		subscriptionTab.display();
	}

	private addEmailSetting(containerEl: HTMLElement): void {
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
	}

	private addSyncTokenSetting(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName('Sync token')
			.setDesc('This token authorizes access to your Google Keep data. Retrieve your token below.')
			.addText(text => {
				text
					.setPlaceholder('Google Keep sync token.')
					.setValue(this.plugin.settings.token)
					.onChange(async (value) => {
						this.plugin.settings.token = value;
						await this.plugin.saveSettings();
					});
				text.inputEl.type = 'password';
				text.inputEl.addEventListener('paste', this.handleTokenPaste.bind(this));
				const toggleButton = text.inputEl.parentElement?.createEl('button', { text: 'Show' });
				toggleButton?.addEventListener('click', (e) => {
					e.preventDefault();
					if (text.inputEl.type === 'password') {
						text.inputEl.type = 'text';
						toggleButton.textContent = 'Hide';
					} else {
						text.inputEl.type = 'password';
						toggleButton.textContent = 'Show';
					}
				});
			});

		new Setting(containerEl)
			.setName('Retrieve your sync token')
			.setDesc('Get your token automatically using our "Retrieval wizard" or manually using the "Github KIM instructions".')
			.addButton(button => button
				.setButtonText('Retrieval wizard')
				.onClick(this.handleRetrieveToken.bind(this)))
			.addButton(button => button
				.setButtonText('Github KIM instructions')
				.onClick(() => {
					window.open('https://github.com/djsudduth/keep-it-markdown', '_blank');
				}));
	}

	private async handleTokenPaste(event: ClipboardEvent): Promise<void> {
		const pastedText = event.clipboardData?.getData('text');
		if (pastedText && pastedText.includes('oauth2_4')) {
			event.preventDefault();
			await exchangeOauthToken(this, this.plugin, pastedText);
			this.display();
		}
		// If the text doesn't contain 'oauth2_4', we don't prevent the default paste behavior
	}

	private async handleRetrieveToken(): Promise<void> {
		if (!this.plugin.settings.email || !this.isValidEmail(this.plugin.settings.email)) {
			new Notice('Please enter a valid email address before retrieving the token.');
			return;
		}
		await initRetrieveToken(this, this.plugin, this.retrieveTokenWebView);
		this.display();
	}

        private addSaveLocationSetting(containerEl: HTMLElement): void {
                new Setting(containerEl)
                        .setName('Save location')
                        .setDesc('Where to save imported notes (relative to vault folder).')
                        .addText(text => text
				.setPlaceholder('KeepSidian')
				.setValue(this.plugin.settings.saveLocation)
				.onChange(async (value) => {
					this.plugin.settings.saveLocation = value;
					await this.plugin.saveSettings();
                                  }));
        }

        private async addAutoSyncSettings(containerEl: HTMLElement): Promise<void> {
                containerEl.createEl('h3', { text: 'Auto Sync' });

                new Setting(containerEl)
                        .setName('Enable auto sync')
                        .setDesc('Automatically sync your notes at regular intervals.')
                        .addToggle(toggle => toggle
                                .setValue(this.plugin.settings.autoSyncEnabled)
                                .onChange(async (value) => {
                                        this.plugin.settings.autoSyncEnabled = value;
                                        await this.plugin.saveSettings();
                                        if (value) {
                                                this.plugin.startAutoSync();
                                        } else {
                                                this.plugin.stopAutoSync();
                                        }
                                }));

                const intervalSetting = new Setting(containerEl)
                        .setName('Sync interval (hours)')
                        .setDesc('Requires subscription')
                        .addText(text => text
                                .setPlaceholder('24')
                                .setValue(this.plugin.settings.autoSyncIntervalHours.toString())
                                .onChange(async (value) => {
                                        const num = Number(value);
                                        if (!isNaN(num) && num > 0) {
                                                this.plugin.settings.autoSyncIntervalHours = num;
                                                await this.plugin.saveSettings();
                                                if (this.plugin.settings.autoSyncEnabled) {
                                                        this.plugin.startAutoSync();
                                                }
                                        }
                                }));

                const isSubscribed = await this.plugin.subscriptionService.isSubscriptionActive();
                if (!isSubscribed) {
                        intervalSetting.setDisabled(true);
                }

                new Setting(containerEl)
                        .setName('Sync log file')
                        .setDesc('Log file name stored in target directory.')
                        .addText(text => text
                                .setPlaceholder('_keepsidian.log')
                                .setValue(this.plugin.settings.syncLogPath)
                                .onChange(async (value) => {
                                        this.plugin.settings.syncLogPath = value;
                                        await this.plugin.saveSettings();
                                }));
        }

	private createRetrieveTokenWebView(containerEl: HTMLElement): void {
		this.retrieveTokenWebView = containerEl.createEl('webview' as keyof HTMLElementTagNameMap, {
			attr: { style: 'width: 100%; height: 600px;' }
		}) as WebviewTag;
		this.retrieveTokenWebView.src = "https://accounts.google.com/EmbeddedSetup";
		this.retrieveTokenWebView.setAttribute('disablewebsecurity', 'true');
		this.retrieveTokenWebView.setAttribute('crossorigin', 'anonymous');
		this.retrieveTokenWebView.hide();
	}
}
