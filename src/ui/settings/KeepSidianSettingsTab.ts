import { WebviewTag } from "electron";
import KeepSidianPlugin from "main";
import {
	PluginSettingTab,
	App,
	Setting,
	Notice,
	setIcon,
} from "obsidian";
import type { IconName, ToggleComponent, ExtraButtonComponent } from "obsidian";
import { SubscriptionSettingsTab } from "./SubscriptionSettingsTab";
import { exchangeOauthToken, initRetrieveToken } from "../../integrations/google/keepToken";
import {
        endRetrievalWizardSession,
        logRetrievalWizardEvent,
        startRetrievalWizardSession,
} from "@integrations/google/retrievalSessionLogger";

export class KeepSidianSettingsTab extends PluginSettingTab {
	private retrieveTokenWebView: WebviewTag;
	private plugin: KeepSidianPlugin;
	private retrieveTokenGuide?: {
		container: HTMLElement;
		titleEl: HTMLElement;
		messageEl: HTMLElement;
		listEl: HTMLOListElement;
		statusEl: HTMLElement;
		webviewContainer: HTMLElement;
		webview: WebviewTag;
	};

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
		containerEl.createEl("hr", { cls: "keepsidian-settings-hr" });
		this.addSyncTokenSetting(containerEl);
		this.createRetrieveTokenWebView(containerEl);
		containerEl.createEl("hr", { cls: "keepsidian-settings-hr" });
		await this.addAutoSyncSettings(containerEl);
		containerEl.createEl("hr", { cls: "keepsidian-settings-hr" });
		await this.addSubscriptionSettings(containerEl);
		containerEl.createEl("hr", { cls: "keepsidian-settings-hr" });
		this.addSupportSection(containerEl);
	}

	private addSupportSection(containerEl: HTMLElement): void {
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
		const subscriptionTab = new SubscriptionSettingsTab(containerEl, this.plugin);
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
		new Setting(containerEl).setName("Configure sync token").setHeading();
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
				text.inputEl.addEventListener("paste", this.handleTokenPaste.bind(this));
				const toggleButton = text.inputEl.parentElement?.createEl("button", {
					text: "Show",
				});
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

                const retrievalSetting = new Setting(containerEl)
                        .setName("Retrieve your sync token")
                        .setDesc(
                                'Get your token automatically using our "Retrieval wizard" or manually using the "Github KIM instructions".'
                        )
                        .addButton((button) =>
				button
					.setButtonText("Retrieval wizard")
					.onClick(this.handleRetrieveToken.bind(this))
                        );

                const githubInstructionsUrl = "https://github.com/djsudduth/keep-it-markdown";
                const githubInstructionsLink = retrievalSetting.controlEl.createEl("a", {
                        text: "Github KIM instructions",
                        attr: {
                                href: githubInstructionsUrl,
                                target: "_blank",
                                rel: "noopener noreferrer",
                                "data-keepsidian-link": "github-instructions",
                        },
                });
                githubInstructionsLink.classList.add("keepsidian-link-button");
                githubInstructionsLink.setAttribute("role", "button");
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
		const sessionMetadata = {
			email: this.plugin.settings.email,
			pluginVersion: this.plugin.manifest.version,
		};
		await startRetrievalWizardSession(this.plugin, sessionMetadata);
		await logRetrievalWizardEvent("info", "Retrieval wizard button clicked", sessionMetadata);
		if (!this.plugin.settings.email || !this.isValidEmail(this.plugin.settings.email)) {
			await logRetrievalWizardEvent("warn", "Retrieval wizard aborted: invalid email", {
				email: this.plugin.settings.email,
			});
			await endRetrievalWizardSession("aborted", { reason: "invalid-email" });
			new Notice("Please enter a valid email address before retrieving the token.");
			return;
		}
		// Ensure the webview exists if display() wasn't called yet in this lifecycle
		if (!this.retrieveTokenWebView) {
			this.createRetrieveTokenWebView(this.containerEl);
			await logRetrievalWizardEvent("debug", "Created retrieval webview for session");
		} else {
			await logRetrievalWizardEvent("debug", "Reusing existing retrieval webview instance");
		}
		await logRetrievalWizardEvent("info", "Initializing retrieval wizard workflow");
		if (
			this.retrieveTokenGuide?.container &&
			typeof (this.retrieveTokenGuide.container as HTMLElement & { show?: () => void }).show ===
				"function"
		) {
			(this.retrieveTokenGuide.container as HTMLElement & { show: () => void }).show();
		}
		if (
			this.retrieveTokenGuide?.webviewContainer &&
			typeof (this.retrieveTokenGuide.webviewContainer as HTMLElement & { show?: () => void }).show ===
				"function"
		) {
			(this.retrieveTokenGuide.webviewContainer as HTMLElement & { show: () => void }).show();
		}

		await initRetrieveToken(this, this.plugin, this.retrieveTokenWebView);
		await logRetrievalWizardEvent("info", "Retrieval wizard workflow completed");
		this.display();
		await logRetrievalWizardEvent("debug", "Settings tab refreshed after retrieval wizard");
	}

	public updateRetrieveTokenInstructions(
		step: number,
		title: string,
		message: string,
		listItems: string[] = []
	): void {
		if (!this.retrieveTokenGuide) {
			return;
		}
		void logRetrievalWizardEvent("debug", "Updating retrieval instructions", {
			step,
			title,
			items: listItems.length,
		});
		const headingPrefix = Number.isFinite(step) ? `Step ${step} of 3: ` : "";
		this.retrieveTokenGuide.titleEl.textContent = `${headingPrefix}${title}`;
		this.retrieveTokenGuide.messageEl.textContent = message;
		const { listEl } = this.retrieveTokenGuide;
		while (listEl.firstChild) {
			listEl.removeChild(listEl.firstChild);
		}
		if (listItems.length > 0) {
			listEl.removeClass("keepsidian-hidden");
			for (const item of listItems) {
				listEl.createEl("li", { text: item });
			}
		} else {
			listEl.addClass("keepsidian-hidden");
		}
	}

	public updateRetrieveTokenStatus(
		message: string,
		type: "info" | "success" | "warning" | "error" = "info"
	): void {
		if (!this.retrieveTokenGuide) {
			return;
		}
		void logRetrievalWizardEvent("debug", "Updating retrieval status", {
			message,
			type,
		});
		const { statusEl } = this.retrieveTokenGuide;
		statusEl.empty();
		if (!message) {
			return;
		}
		statusEl.setText(message);
		statusEl.removeClass(
			"keepsidian-status-info",
			"keepsidian-status-success",
			"keepsidian-status-warning",
			"keepsidian-status-error"
		);
		switch (type) {
			case "success":
				statusEl.addClass("keepsidian-status-success");
				break;
			case "warning":
				statusEl.addClass("keepsidian-status-warning");
				break;
			case "error":
				statusEl.addClass("keepsidian-status-error");
				break;
			default:
				statusEl.addClass("keepsidian-status-info");
		}
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
		new Setting(containerEl).setName("Auto sync").setHeading();

		let updateTwoWaySettingsState: () => void = () => {};

		new Setting(containerEl)
			.setName("Enable auto sync")
			.setDesc("Automatically sync your notes at regular intervals.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.autoSyncEnabled).onChange(async (value) => {
					this.plugin.settings.autoSyncEnabled = value;
					await this.plugin.saveSettings();
					if (value) {
						this.plugin.startAutoSync();
					} else {
						this.plugin.stopAutoSync();
					}
					updateTwoWaySettingsState?.();
				})
			);

		const isSubscribed = await this.plugin.subscriptionService.isSubscriptionActive();

		const intervalSetting = new Setting(containerEl)
			.setName("Sync interval (hours)")
			.setDesc(
				"Change the default sync interval." +
					(isSubscribed ? "" : " (requires a subscription)")
			)
			.addText((text) =>
				text
					.setPlaceholder("24")
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
					})
			);

		if (!isSubscribed) {
			intervalSetting.setDisabled(true);
			intervalSetting.setClass("requires-subscription");
		}

		new Setting(containerEl)
			.setName("Two-way sync (beta)")
			.setHeading();

		let suppressTwoWayUpdates = false;
		let backupToggle: ToggleComponent | undefined;
		let manualTwoWayToggle: ToggleComponent | undefined;
		let autoTwoWayToggle: ToggleComponent | undefined;
		let manualTwoWaySetting!: Setting;
		let autoTwoWaySetting!: Setting;

		const formatRequirementList = (items: string[]): string => {
			if (items.length === 1) {
				return items[0];
			}
			const last = items[items.length - 1];
			return `${items.slice(0, -1).join(", ")}, and ${last}`;
		};

		updateTwoWaySettingsState = () => {
			suppressTwoWayUpdates = true;
			const { settings } = this.plugin;
			const backupAcknowledged = settings.twoWaySyncBackupAcknowledged;
			const manualTwoWayEnabled = settings.twoWaySyncEnabled;
			const autoTwoWayEnabled = settings.twoWaySyncAutoSyncEnabled;
			const autoSyncActive = settings.autoSyncEnabled;

			backupToggle?.setValue(backupAcknowledged);
			manualTwoWayToggle?.setValue(manualTwoWayEnabled);
			autoTwoWayToggle?.setValue(autoTwoWayEnabled);

			const manualDesc = backupAcknowledged
				? "Unlock manual uploads and merges while beta is active."
				: "Confirm backups above to unlock manual uploads and merges.";
			manualTwoWaySetting.setDesc(manualDesc);
			manualTwoWaySetting.setDisabled(!backupAcknowledged);

			const requirements: string[] = [];
			if (!backupAcknowledged) {
				requirements.push("confirm backups above");
			}
			if (backupAcknowledged && !manualTwoWayEnabled) {
				requirements.push("enable two-way sync above");
			}
			if (!isSubscribed) {
				requirements.push("upgrade to KeepSidian Premium");
			}
			if (
				backupAcknowledged &&
				manualTwoWayEnabled &&
				isSubscribed &&
				!autoSyncActive
			) {
				requirements.push("turn on auto sync");
			}

			const autoDesc = requirements.length
				? `Requires you to ${formatRequirementList(requirements)} before this runs automatically.`
				: "Auto sync will run uploads and downloads together when enabled.";
			autoTwoWaySetting.setDesc(autoDesc);
			autoTwoWaySetting.setDisabled(requirements.length > 0);
			suppressTwoWayUpdates = false;
		};

		// eslint-disable-next-line obsidianmd/hardcoded-config-path
		const backupGuideUrl = "https://help.obsidian.md/Advanced+topics/Sync#Backups";

		const backupGuideSetting = new Setting(containerEl)
			.setName("Vault backup guidance")
			.setDesc(
				"Review Obsidian's backup documentation before enabling uploads."
			);

		const backupGuideLink = backupGuideSetting.controlEl.createEl("a", {
			text: "Open backup guide",
			attr: {
				href: backupGuideUrl,
				target: "_blank",
				rel: "noopener noreferrer",
				"data-keepsidian-link": "obsidian-backup-guide",
			},
		});
		backupGuideLink.classList.add("keepsidian-link-button");
		backupGuideLink.setAttribute("role", "button");

		new Setting(containerEl)
			.setName("Confirm vault backups")
			.setDesc(
				"Confirm you captured a full vault backup before enabling uploads. Downloads stay safe until you opt in."
			)
			.addToggle((toggle) => {
				backupToggle = toggle;
				toggle
					.setValue(this.plugin.settings.twoWaySyncBackupAcknowledged)
					.onChange(async (value) => {
						if (suppressTwoWayUpdates) {
							return;
						}
						this.plugin.settings.twoWaySyncBackupAcknowledged = value;
						if (!value) {
							this.plugin.settings.twoWaySyncEnabled = false;
							this.plugin.settings.twoWaySyncAutoSyncEnabled = false;
						}
						await this.plugin.saveSettings();
						updateTwoWaySettingsState();
					});
			});

		manualTwoWaySetting = new Setting(containerEl)
			.setName("Enable two-way sync (beta)")
			.addToggle((toggle) => {
				manualTwoWayToggle = toggle;
				toggle
					.setValue(this.plugin.settings.twoWaySyncEnabled)
					.onChange(async (value) => {
						if (suppressTwoWayUpdates) {
							return;
						}
						if (!this.plugin.settings.twoWaySyncBackupAcknowledged) {
							updateTwoWaySettingsState();
							return;
						}
						this.plugin.settings.twoWaySyncEnabled = value;
						if (!value) {
							this.plugin.settings.twoWaySyncAutoSyncEnabled = false;
						}
						await this.plugin.saveSettings();
						updateTwoWaySettingsState();
					});
			});

		autoTwoWaySetting = new Setting(containerEl)
			.setName("Enable two-way sync for auto sync")
			.addToggle((toggle) => {
				autoTwoWayToggle = toggle;
				toggle
					.setValue(this.plugin.settings.twoWaySyncAutoSyncEnabled)
					.onChange(async (value) => {
						if (suppressTwoWayUpdates) {
							return;
						}
						const prerequisitesMet =
							this.plugin.settings.twoWaySyncBackupAcknowledged &&
							this.plugin.settings.twoWaySyncEnabled &&
							isSubscribed &&
							this.plugin.settings.autoSyncEnabled;
						if (!prerequisitesMet) {
							updateTwoWaySettingsState();
							return;
						}
						this.plugin.settings.twoWaySyncAutoSyncEnabled = value;
						await this.plugin.saveSettings();
						updateTwoWaySettingsState();
					});
			});

		if (!isSubscribed) {
			autoTwoWaySetting.addExtraButton((button: ExtraButtonComponent) => {
				button.setIcon("lock");
				button.setTooltip("Requires KeepSidian Premium");
			});
			autoTwoWaySetting.setClass("requires-subscription");
		}

		updateTwoWaySettingsState();
	}

	private createRetrieveTokenWebView(containerEl: HTMLElement): void {
		const wrapper = containerEl.createDiv("keepsidian-retrieve-token-wrapper");
		const guideContainer = wrapper.createDiv("keepsidian-retrieve-token-guide");
		const titleEl = guideContainer.createDiv({
			cls: "keepsidian-retrieve-token-guide__title",
			text: "Token retrieval",
		});
		const messageEl = guideContainer.createEl("p", {
			cls: "keepsidian-retrieve-token-guide__message",
		});
		const listEl = guideContainer.createEl("ol", {
			cls: "keepsidian-retrieve-token-guide__list keepsidian-hidden",
		});
		const statusEl = guideContainer.createDiv("keepsidian-retrieve-token-guide__status");

		const webviewContainer = wrapper.createDiv("keepsidian-retrieve-token-webview");
		this.retrieveTokenWebView = webviewContainer.createEl(
			"webview" as keyof HTMLElementTagNameMap,
			{
				attr: { style: "width: 100%; height: 600px;" },
			}
		) as WebviewTag;
		this.retrieveTokenWebView.setAttribute("disablewebsecurity", "true");
		this.retrieveTokenWebView.setAttribute("crossorigin", "anonymous");
		this.retrieveTokenWebView.setAttribute("disableblinkfeatures", "AutomationControlled");
		this.retrieveTokenWebView.setAttribute("allowpopups", "");
		this.retrieveTokenWebView.setAttribute("partition", "persist:keepsidian");
		// this.retrieveTokenWebView.src = "https://accounts.google.com/EmbeddedSetup";
		webviewContainer.hide();
		guideContainer.hide();

		this.retrieveTokenGuide = {
			container: guideContainer,
			titleEl,
			messageEl,
			listEl,
			statusEl,
			webviewContainer,
			webview: this.retrieveTokenWebView,
		};
	}
}
