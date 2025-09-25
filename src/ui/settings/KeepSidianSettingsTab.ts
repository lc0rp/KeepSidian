import { WebviewTag } from "electron";
import KeepSidianPlugin from "main";
import {
        PluginSettingTab,
        App,
        Setting,
        Notice,
        setIcon,
} from "obsidian";
import type { IconName } from "obsidian";
import { SubscriptionSettingsTab } from "./SubscriptionSettingsTab";
import {
	exchangeOauthToken,
	initRetrieveToken,
} from "../../integrations/google/keepToken";

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

                this.addSupportSection(containerEl);
                this.addEmailSetting(containerEl);
                this.addSaveLocationSetting(containerEl);
				containerEl.createEl("hr", {cls: "keepsidian-settings-hr"});
                this.addSyncTokenSetting(containerEl);
                this.createRetrieveTokenWebView(containerEl);
				containerEl.createEl("hr", {cls: "keepsidian-settings-hr"});
                await this.addAutoSyncSettings(containerEl);
				containerEl.createEl("hr", {cls: "keepsidian-settings-hr"});
                await this.addSubscriptionSettings(containerEl);
				containerEl.createEl("hr", {cls: "keepsidian-settings-hr"});
                this.addSupportSection(containerEl);
        }

        private addSupportSection(
                containerEl: HTMLElement
        ): void {
                const supportRow = containerEl.createEl("div", {
                        cls: "keepsidian-support-row",
                });

				supportRow.createEl("span", {
					cls: "keepsidian-support-version",
					text: `KeepSidian v${this.plugin.manifest.version}`,
				});

				supportRow.createEl("span", {
					cls: "keepsidian-support-spacer",
				});

                supportRow.createEl("span", {
                        cls: "keepsidian-support-label",
                        text: "Need help?",
                });

                const linksContainer = supportRow.createEl("div", {
                        cls: "keepsidian-support-links",
                });

                this.createSupportLink(
                        linksContainer,
                        "GitHub Issues",
                        "https://github.com/lc0rp/KeepSidian/issues",
                        "github"
                );

                this.createSupportLink(
                        linksContainer,
                        "Discord DM (@lc0rp)",
                        "https://discord.com/users/lc0rp",
                        "message-circle"
                );
        }

        private createSupportLink(
                parentEl: HTMLElement,
                label: string,
                href: string,
                icon: IconName
        ): void {
                const linkEl = parentEl.createEl("a", {
                        cls: "keepsidian-support-link",
                });
                linkEl.setAttribute("href", href);
                linkEl.setAttribute("target", "_blank");
                linkEl.setAttribute("rel", "noopener noreferrer");
                linkEl.setAttribute("aria-label", label);
                linkEl.setAttribute("title", label);

                const iconEl = linkEl.createEl("span", {
                        cls: "keepsidian-support-icon",
                });
                setIcon(iconEl, icon);

                linkEl.createEl("span", {
                        cls: "keepsidian-support-text",
                        text: label,
                });
        }

	private async addSubscriptionSettings(containerEl: HTMLElement): Promise<void> {
		const subscriptionTab = new SubscriptionSettingsTab(
			containerEl,
			this.plugin
		);
		await subscriptionTab.display();
	}

	private addEmailSetting(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName("Email")
			.setDesc("Your Google Keep email.")
			.addText((text) =>
				text
					.setPlaceholder("example@gmail.com")
					.setValue(this.plugin.settings.email)
					.onChange(async (value) => {
						this.plugin.settings.email = value;
						await this.plugin.saveSettings();
					})
			);
	}

	private addSyncTokenSetting(containerEl: HTMLElement): void {
		containerEl.createEl("h4", { text: "Configure sync token" });
		new Setting(containerEl)
			.setName("Sync token")
			.setDesc(
				"This token authorizes access to your Google Keep data. Retrieve your token below."
			)
			.addText((text) => {
				text.setPlaceholder("Google Keep sync token.")
					.setValue(this.plugin.settings.token)
					.onChange(async (value) => {
						this.plugin.settings.token = value;
						await this.plugin.saveSettings();
					});
				text.inputEl.type = "password";
				text.inputEl.addEventListener(
					"paste",
					this.handleTokenPaste.bind(this)
				);
				const toggleButton = text.inputEl.parentElement?.createEl(
					"button",
					{ text: "Show" }
				);
				toggleButton?.addEventListener("click", (e) => {
					e.preventDefault();
					if (text.inputEl.type === "password") {
						text.inputEl.type = "text";
						toggleButton.textContent = "Hide";
					} else {
						text.inputEl.type = "password";
						toggleButton.textContent = "Show";
					}
				});
			});

		new Setting(containerEl)
			.setName("Retrieve your sync token")
			.setDesc(
				'Get your token automatically using our "Retrieval wizard" or manually using the "Github KIM instructions".'
			)
			.addButton((button) =>
				button
					.setButtonText("Retrieval wizard")
					.onClick(this.handleRetrieveToken.bind(this))
			)
			.addButton((button) =>
				button.setButtonText("Github KIM instructions").onClick(() => {
					window.open(
						"https://github.com/djsudduth/keep-it-markdown",
						"_blank"
					);
				})
			);
	}

	private async handleTokenPaste(event: ClipboardEvent): Promise<void> {
		const pastedText = event.clipboardData?.getData("text");
		if (pastedText && pastedText.includes("oauth2_4")) {
			event.preventDefault();
			await exchangeOauthToken(this, this.plugin, pastedText);
			this.display();
		}
		// If the text doesn't contain 'oauth2_4', we don't prevent the default paste behavior
	}

	private async handleRetrieveToken(): Promise<void> {
		if (
			!this.plugin.settings.email ||
			!this.isValidEmail(this.plugin.settings.email)
		) {
			new Notice(
				"Please enter a valid email address before retrieving the token."
			);
			return;
		}
		// Ensure the webview exists if display() wasn't called yet in this lifecycle
		if (!this.retrieveTokenWebView) {
			this.createRetrieveTokenWebView(this.containerEl);
		}
		await initRetrieveToken(this, this.plugin, this.retrieveTokenWebView);
		this.display();
	}

	private addSaveLocationSetting(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName("Save location")
			.setDesc(
				"Where to save imported notes (relative to vault). Will be created if it doesn't exist."
			)
			.addText((text) =>
				text
					.setPlaceholder("KeepSidian")
					.setValue(this.plugin.settings.saveLocation)
					.onChange(async (value) => {
						this.plugin.settings.saveLocation = value;
						await this.plugin.saveSettings();
					})
			);
	}

	private async addAutoSyncSettings(containerEl: HTMLElement): Promise<void> {
		containerEl.createEl("h4", { text: "Auto sync" });

		new Setting(containerEl)
			.setName("Enable auto sync")
			.setDesc("Automatically sync your notes at regular intervals.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoSyncEnabled)
					.onChange(async (value) => {
						this.plugin.settings.autoSyncEnabled = value;
						await this.plugin.saveSettings();
						if (value) {
							this.plugin.startAutoSync();
						} else {
							this.plugin.stopAutoSync();
						}
					})
			);

		const isSubscribed =
			await this.plugin.subscriptionService.isSubscriptionActive();

		const intervalSetting = new Setting(containerEl)
			.setName("Sync interval (hours)")
			.setDesc(
				"Change the default sync interval." +
					(isSubscribed ? "" : " (requires a subscription)")
			)
			.addText((text) =>
				text
					.setPlaceholder("24")
					.setValue(
						this.plugin.settings.autoSyncIntervalHours.toString()
					)
					.onChange(async (value) => {
						const num = Number(value);
						if (!isNaN(num) && num > 0) {
							this.plugin.settings.autoSyncIntervalHours = num;
							await this.plugin.saveSettings();
							if (this.plugin.settings.autoSyncEnabled) {
								this.plugin.startAutoSync();
							}
						}
					})
			);

		if (!isSubscribed) {
			intervalSetting.setDisabled(true);
			intervalSetting.setClass("requires-subscription");
		}
	}

	private createRetrieveTokenWebView(containerEl: HTMLElement): void {
		this.retrieveTokenWebView = containerEl.createEl(
			"webview" as keyof HTMLElementTagNameMap,
			{
				attr: { style: "width: 100%; height: 600px;" },
			}
		) as WebviewTag;
		this.retrieveTokenWebView.src =
			"https://accounts.google.com/EmbeddedSetup";
		this.retrieveTokenWebView.setAttribute("disablewebsecurity", "true");
		this.retrieveTokenWebView.setAttribute("crossorigin", "anonymous");
		this.retrieveTokenWebView.hide();
	}
}
