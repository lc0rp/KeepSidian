import type { WebviewTag } from "electron";
import KeepSidianPlugin from "main";
import { PluginSettingTab, App, Notice, Platform, Setting } from "obsidian";
import { exchangeOauthToken } from "../../integrations/google/keepToken";
import { loadKeepTokenDesktop } from "../../integrations/google/keepTokenDesktopLoader";
import { runOauthBrowserAutomation } from "@integrations/google/keepTokenBrowserAutomation";
import {
	endRetrievalWizardSession,
	logRetrievalWizardEvent,
	startRetrievalWizardSession,
} from "@integrations/google/retrievalSessionLogger";
import { addAutoSyncSettings as addAutoSyncSettingsSection } from "./KeepSidianSettingsTab/autoSyncSettings";
import {
	addEmailSetting as addEmailSettingSection,
	addGithubInstructionsLink as addGithubInstructionsLinkSection,
	addSaveLocationSetting as addSaveLocationSettingSection,
	addSubscriptionSettings as addSubscriptionSettingsSection,
	addSupportSection as addSupportSectionSection,
} from "./KeepSidianSettingsTab/commonSettings";
import {
	addAdvancedSettings as addAdvancedSettingsSection,
	addSyncTokenSetting as addSyncTokenSettingSection,
} from "./KeepSidianSettingsTab/tokenSettings";

export class KeepSidianSettingsTab extends PluginSettingTab {
	private retrieveTokenWebView?: WebviewTag;
	private plugin: KeepSidianPlugin;
	private retrieveTokenGuide?: {
		container: HTMLElement;
		titleEl: HTMLElement;
		messageEl: HTMLElement;
		listEl: HTMLOListElement;
		actionButton: HTMLButtonElement;
		actionHandler?: (event: MouseEvent) => void;
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

	private isLikelyLongLivedToken(token?: string | null): boolean {
		const trimmed = token?.trim();
		if (!trimmed) {
			return false;
		}

		const normalized = trimmed.toLowerCase();
		if (normalized.includes("oauth2_")) {
			return false;
		}

		return trimmed.length >= 20;
	}

	display(): void {
		void this.renderSettings();
	}

	private async renderSettings(): Promise<void> {
		const { containerEl } = this;
		containerEl.empty();

		this.addSupportSection(containerEl);
		this.addEmailSetting(containerEl);
		this.addSaveLocationSetting(containerEl);
		containerEl.createEl("hr", { cls: "keepsidian-settings-hr" });
		this.addSyncTokenSetting(containerEl);
		if (Platform.isDesktopApp) {
			this.createRetrieveTokenWebView(containerEl);
		}
		containerEl.createEl("hr", { cls: "keepsidian-settings-hr" });
		await this.addAutoSyncSettings(containerEl);
		containerEl.createEl("hr", { cls: "keepsidian-settings-hr" });
		await this.addSubscriptionSettings(containerEl);
		containerEl.createEl("hr", { cls: "keepsidian-settings-hr" });
		this.addSupportSection(containerEl);
	}

	private addSupportSection(containerEl: HTMLElement): void {
		addSupportSectionSection(this.plugin, containerEl);
	}

	private async addSubscriptionSettings(containerEl: HTMLElement): Promise<void> {
		await addSubscriptionSettingsSection(this.plugin, containerEl);
	}

	private addEmailSetting(containerEl: HTMLElement): void {
		addEmailSettingSection(this.plugin, containerEl);
	}

	private addSyncTokenSetting(containerEl: HTMLElement): void {
		addSyncTokenSettingSection(containerEl, {
			plugin: this.plugin,
			isLikelyLongLivedToken: (token) => this.isLikelyLongLivedToken(token),
			onTokenPaste: async (event) => {
				await this.handleTokenPaste(event);
			},
			onAutomationLaunch: async (engine) => {
				await this.handleAutomationLaunch(engine);
			},
			onExchangeOauthToken: async (token) => {
				await exchangeOauthToken(this, this.plugin, token);
			},
			addGithubInstructionsLink: (setting) => {
				this.addGithubInstructionsLink(setting);
			},
		});
	}

	private addGithubInstructionsLink(setting: Setting): void {
		addGithubInstructionsLinkSection(setting);
	}

	private addAdvancedSettings(containerEl: HTMLElement): void {
		addAdvancedSettingsSection(this.plugin, containerEl);
	}

	private async handleTokenPaste(event: ClipboardEvent): Promise<void> {
		const pastedText = event.clipboardData?.getData("text");
		if (pastedText && pastedText.trim().startsWith("oauth2_4")) {
			event.preventDefault();
			await exchangeOauthToken(this, this.plugin, pastedText.trim());
			this.display();
		}
	}

	private async handleRetrieveToken(): Promise<void> {
		if (!this.plugin.settings.email || !this.isValidEmail(this.plugin.settings.email)) {
			new Notice("Please enter a valid email address before retrieving the token.");
			return;
		}
		if (!Platform.isDesktopApp) {
			new Notice("Token retrieval wizard is only available on desktop. Paste a token instead.");
			return;
		}
		const sessionMetadata = {
			email: this.plugin.settings.email,
			pluginVersion: this.plugin.manifest.version,
		};
		await startRetrievalWizardSession(this.plugin, sessionMetadata);
		await logRetrievalWizardEvent("info", "Retrieval wizard button clicked", sessionMetadata);
		try {
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
				typeof (this.retrieveTokenGuide.webviewContainer as HTMLElement & { show?: () => void })
					.show === "function"
			) {
				(this.retrieveTokenGuide.webviewContainer as HTMLElement & { show: () => void }).show();
			}

			const { initRetrieveToken } = await loadKeepTokenDesktop(this.plugin);
			await initRetrieveToken(this, this.plugin, this.retrieveTokenWebView!, async (oauthToken) => {
				await exchangeOauthToken(this, this.plugin, oauthToken);
			});
			await logRetrievalWizardEvent("info", "Retrieval wizard workflow completed");
			this.display();
			await logRetrievalWizardEvent("debug", "Settings tab refreshed after retrieval wizard");
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Unable to initialize retrieval wizard.";
			new Notice(message);
			await logRetrievalWizardEvent("error", "Retrieval wizard initialization failed", {
				errorMessage: message,
			});
		}
	}

	private async handleAutomationLaunch(engine: "puppeteer" | "playwright"): Promise<void> {
		if (!this.plugin.settings.email || !this.isValidEmail(this.plugin.settings.email)) {
			new Notice("Please enter a valid email address before launching browser automation.");
			return;
		}
		if (!Platform.isDesktopApp) {
			new Notice("Browser automation is only available on desktop.");
			return;
		}
		const sessionMetadata = {
			email: this.plugin.settings.email,
			pluginVersion: this.plugin.manifest.version,
			engine,
			flow: "browser-automation",
		};
		await startRetrievalWizardSession(this.plugin, sessionMetadata);
		await logRetrievalWizardEvent("info", "Browser automation button clicked", sessionMetadata);
		new Notice(`Launching ${engine} login window...`);
		try {
			const useSystemBrowser = engine === "playwright" ? true : false;
			if (
				engine === "playwright" &&
				this.plugin.settings.oauthPlaywrightUseSystemBrowser !== true
			) {
				this.plugin.settings.oauthPlaywrightUseSystemBrowser = true;
				await this.plugin.saveSettings();
			}
			const result = await runOauthBrowserAutomation(this.plugin, engine, {
				debug: this.plugin.settings.oauthDebugMode,
				useSystemBrowser,
			});
			await logRetrievalWizardEvent("info", "Browser automation returned oauth token", {
				engine,
				tokenReceived: Boolean(result.oauth_token),
			});
			await exchangeOauthToken(this, this.plugin, result.oauth_token);
			await endRetrievalWizardSession("success", {
				engine,
				flow: "browser-automation",
			});
		} catch (error) {
			const rawMessage =
				error instanceof Error ? error.message : "Browser automation failed to capture a token.";
			const message = rawMessage.includes("ENOENT")
				? "Unable to launch browser automation. Please install Node.js or run the script manually."
				: rawMessage;
			new Notice(message);
			await logRetrievalWizardEvent("error", "Browser automation failed", {
				engine,
				errorMessage: rawMessage,
			});
			await endRetrievalWizardSession("error", {
				engine,
				flow: "browser-automation",
				reason: message,
			});
		}
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

	public updateRetrieveTokenAction(action?: { label: string; onClick: () => void } | null): void {
		if (!this.retrieveTokenGuide) {
			return;
		}
		const { actionButton } = this.retrieveTokenGuide;
		if (this.retrieveTokenGuide.actionHandler) {
			actionButton.removeEventListener("click", this.retrieveTokenGuide.actionHandler);
			this.retrieveTokenGuide.actionHandler = undefined;
		}
		if (!action) {
			actionButton.addClass("keepsidian-hidden");
			return;
		}
		actionButton.removeClass("keepsidian-hidden");
		actionButton.setText(action.label);
		const handler = (event: MouseEvent) => {
			event.preventDefault();
			action.onClick();
		};
		actionButton.addEventListener("click", handler);
		this.retrieveTokenGuide.actionHandler = handler;
	}

	private addSaveLocationSetting(containerEl: HTMLElement): void {
		addSaveLocationSettingSection(this.plugin, containerEl);
	}

	private async addAutoSyncSettings(containerEl: HTMLElement): Promise<void> {
		await addAutoSyncSettingsSection(this.plugin, containerEl);
	}

	private createRetrieveTokenWebView(containerEl: HTMLElement): void {
		if (!Platform.isDesktopApp) {
			return;
		}
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
		const actionButton = guideContainer.createEl("button", {
			cls: "keepsidian-retrieve-token-guide__action keepsidian-link-button keepsidian-hidden",
			text: "Reopen DevTools",
		});
		actionButton.setAttribute("type", "button");
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
		webviewContainer.hide();
		guideContainer.hide();

		this.retrieveTokenGuide = {
			container: guideContainer,
			titleEl,
			messageEl,
			listEl,
			actionButton,
			statusEl,
			webviewContainer,
			webview: this.retrieveTokenWebView,
		};
	}
}
