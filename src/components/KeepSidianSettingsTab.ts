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
		containerEl.createEl('h2', { text: 'KeepSidian Settings' });

		this.addEmailSetting(containerEl);
		this.addSyncTokenSetting(containerEl);
		this.createRetrieveTokenWebView(containerEl);
		this.addSaveLocationSetting(containerEl);
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
			.setDesc('Your Google Keep sync token is a unique code that authorizes this plugin to access your Google Keep data. You can retrieve it by clicking the "Retrieve token" button.')
			.addText(text => {
				text
					.setPlaceholder('Your Google Keep sync token.')
				.setValue(this.plugin.settings.token)
				.onChange(async (value) => {
					this.plugin.settings.token = value;
					await this.plugin.saveSettings();
				});
				text.inputEl.addEventListener('paste', this.handleTokenPaste.bind(this));
				text.inputEl.type = 'password';
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
			})
			.addButton(button => button
				.setButtonText('Retrieve token')
				.onClick(this.handleRetrieveToken.bind(this))); 
	}

	private async handleTokenPaste(event: ClipboardEvent): Promise<void> {
		event.preventDefault();
		const pastedText = event.clipboardData?.getData('text');
		if (pastedText && pastedText.includes('oauth2_4')) {
			await exchangeOauthToken(this, this.plugin, pastedText);
			this.display();
		}
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
