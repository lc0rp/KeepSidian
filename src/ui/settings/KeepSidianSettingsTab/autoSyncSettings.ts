import type KeepSidianPlugin from "main";
import { Setting } from "obsidian";
import type { ToggleComponent } from "obsidian";

export async function addAutoSyncSettings(
	plugin: KeepSidianPlugin,
	containerEl: HTMLElement
): Promise<void> {
	new Setting(containerEl).setName("Background sync").setHeading();

	let updateTwoWaySettingsState: () => void = () => {};

	new Setting(containerEl)
		.setName("Enable background sync")
		.setDesc("Quietly sync your notes at regular intervals.")
		.addToggle((toggle) =>
			toggle.setValue(plugin.settings.autoSyncEnabled).onChange(async (value) => {
				plugin.settings.autoSyncEnabled = value;
				plugin.refreshAutoSyncSafeguards();
				await plugin.saveSettings();
				updateTwoWaySettingsState?.();
				if (value) {
					plugin.startAutoSync();
				} else {
					plugin.stopAutoSync();
				}
			})
		);

	const isSubscribed = await plugin.subscriptionService.isSubscriptionActive();

	const intervalSetting = new Setting(containerEl)
		.setName("Sync interval (hours)")
		.setDesc("Change the default sync interval." + (isSubscribed ? "" : " (Available to project supporters)"))
		.addText((text) =>
			text
				.setPlaceholder("24")
				.setValue(plugin.settings.autoSyncIntervalHours.toString())
				.onChange(async (value) => {
					const num = Number(value);
					if (!isNaN(num) && num > 0) {
						plugin.settings.autoSyncIntervalHours = num;
						await plugin.saveSettings();
						if (plugin.settings.autoSyncEnabled) {
							plugin.startAutoSync();
						}
					}
				})
		);

	if (!isSubscribed) {
		intervalSetting.setDisabled(true);
		intervalSetting.setClass("requires-subscription");
	}

	new Setting(containerEl).setName("Two-way sync (experimental)").setHeading();

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
		const { settings } = plugin;
		const backupAcknowledged = settings.twoWaySyncBackupAcknowledged;
		const manualTwoWayEnabled = settings.twoWaySyncEnabled;
		const autoTwoWayEnabled = settings.twoWaySyncAutoSyncEnabled;
		const autoSyncActive = settings.autoSyncEnabled;

		backupToggle?.setValue(backupAcknowledged);
		manualTwoWayToggle?.setValue(manualTwoWayEnabled);
		autoTwoWayToggle?.setValue(autoTwoWayEnabled);

		const manualDesc = backupAcknowledged
			? "Turn on the 'Upload' and 'Two-way sync' commands."
			: "Turn on the 'Upload' and 'Two-way sync' commands. (Please opt-in above to activate)";
		manualTwoWaySetting.setDesc(manualDesc);
		manualTwoWaySetting.setDisabled(!backupAcknowledged);

		const requirements: string[] = [];
		if (!isSubscribed) {
			requirements.push("Available to project supporters");
		}
		if (!backupAcknowledged) {
			requirements.push("requires opt-in above");
		}
		if (backupAcknowledged && !manualTwoWayEnabled) {
			requirements.push("requires two-way sync");
		}

		if (backupAcknowledged && manualTwoWayEnabled && isSubscribed && !autoSyncActive) {
			requirements.push("requires background sync");
		}

		const autoDesc = requirements.length
			? `Background sync will run uploads and downloads together when enabled. (${formatRequirementList(
					requirements
			  )})`
			: "Background sync will run uploads and downloads together when enabled.";
		autoTwoWaySetting.setDesc(autoDesc);
		autoTwoWaySetting.setDisabled(requirements.length > 0);
		suppressTwoWayUpdates = false;
	};

	const backupGuideUrl = "https://help." + "obsidian.md/backup";

	const backupGuideSetting = new Setting(containerEl)
		.setName("Backup advisory ⚠️")
		.setDesc(
			"This is an experimental feature. Media uploads are not supported. To protect your data, KeepSidian attempts to archive conflicting Google Keep notes, and only downloads to the 'save location' specified in the settings above. As always, please remember to back up your vault."
		);

	const backupGuideLink = backupGuideSetting.controlEl.createEl("a", {
		text: "🌎 Obsidian backup guide",
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
		.setName("Confirm opt in")
		.setDesc("I've reviewed the info above and the backup guide. Let's proceed.")
		.addToggle((toggle) => {
			backupToggle = toggle;
			toggle.setValue(plugin.settings.twoWaySyncBackupAcknowledged).onChange(async (value) => {
				if (suppressTwoWayUpdates) {
					return;
				}
				plugin.settings.twoWaySyncBackupAcknowledged = value;
				if (!value) {
					plugin.settings.twoWaySyncEnabled = false;
					plugin.settings.twoWaySyncAutoSyncEnabled = false;
				}
				plugin.refreshAutoSyncSafeguards();
				await plugin.saveSettings();
				updateTwoWaySettingsState();
			});
		});

	manualTwoWaySetting = new Setting(containerEl).setName("Enable two-way sync").addToggle((toggle) => {
		manualTwoWayToggle = toggle;
		toggle.setValue(plugin.settings.twoWaySyncEnabled).onChange(async (value) => {
			if (suppressTwoWayUpdates) {
				return;
			}
			if (!plugin.settings.twoWaySyncBackupAcknowledged) {
				updateTwoWaySettingsState();
				return;
			}
			plugin.settings.twoWaySyncEnabled = value;
			if (!value) {
				plugin.settings.twoWaySyncAutoSyncEnabled = false;
			}
			plugin.refreshAutoSyncSafeguards();
			await plugin.saveSettings();
			updateTwoWaySettingsState();
		});
	});

	autoTwoWaySetting = new Setting(containerEl).setName("Enable two-way background sync").addToggle((toggle) => {
		autoTwoWayToggle = toggle;
		toggle.setValue(plugin.settings.twoWaySyncAutoSyncEnabled).onChange(async (value) => {
			if (suppressTwoWayUpdates) {
				return;
			}
			const prerequisitesMet =
				plugin.settings.twoWaySyncBackupAcknowledged &&
				plugin.settings.twoWaySyncEnabled &&
				isSubscribed &&
				plugin.settings.autoSyncEnabled;
			if (!prerequisitesMet) {
				updateTwoWaySettingsState();
				return;
			}
			plugin.settings.twoWaySyncAutoSyncEnabled = value;
			plugin.refreshAutoSyncSafeguards();
			await plugin.saveSettings();
			updateTwoWaySettingsState();
		});
	});

	if (!isSubscribed) {
		autoTwoWaySetting.setClass("requires-subscription");
	}

	updateTwoWaySettingsState();
}
