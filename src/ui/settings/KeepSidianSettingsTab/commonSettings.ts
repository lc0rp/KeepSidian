import type KeepSidianPlugin from "main";
import { Setting, setIcon } from "obsidian";
import type { IconName } from "obsidian";
import { SubscriptionSettingsTab } from "../SubscriptionSettingsTab";

export function addSupportSection(plugin: KeepSidianPlugin, containerEl: HTMLElement): void {
	const supportRow = containerEl.createEl("div", {
		cls: "keepsidian-support-row",
	});

	supportRow.createEl("span", {
		cls: "keepsidian-support-version",
		text: `KeepSidian v${plugin.manifest.version}`,
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

	createSupportLink(
		linksContainer,
		"GitHub Issues",
		"https://github.com/lc0rp/KeepSidian/issues",
		"github"
	);
	createSupportLink(
		linksContainer,
		"Discord DM (@lc0rp)",
		"https://discord.com/users/lc0rp",
		"message-circle"
	);
}

function createSupportLink(
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

export async function addSubscriptionSettings(
	plugin: KeepSidianPlugin,
	containerEl: HTMLElement
): Promise<void> {
	const subscriptionTab = new SubscriptionSettingsTab(containerEl, plugin);
	await subscriptionTab.display();
}

export function addEmailSetting(plugin: KeepSidianPlugin, containerEl: HTMLElement): void {
	new Setting(containerEl)
		.setName("Email")
		.setDesc("Your Google Keep email.")
		.addText((text) =>
			text
				.setPlaceholder("Example@gmail.com")
				.setValue(plugin.settings.email)
				.onChange(async (value) => {
					plugin.settings.email = value;
					await plugin.saveSettings();
				})
		);
}

export function addSaveLocationSetting(plugin: KeepSidianPlugin, containerEl: HTMLElement): void {
	new Setting(containerEl)
		.setName("Save location")
		.setDesc("Where to save imported notes (relative to vault). Will be created if it doesn't exist.")
		.addText((text) =>
			text
				.setPlaceholder("KeepSidian")
				.setValue(plugin.settings.saveLocation)
				.onChange(async (value) => {
					plugin.settings.saveLocation = value;
					await plugin.saveSettings();
				})
		);
}

export function addGithubInstructionsLink(setting: Setting): void {
	const githubInstructionsUrl = "https://github.com/djsudduth/keep-it-markdown";
	const githubInstructionsLink = setting.controlEl.createEl("a", {
		text: "🌎 GitHub KIM instructions",
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
