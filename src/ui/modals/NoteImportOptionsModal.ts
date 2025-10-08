import { App, Modal, Setting } from "obsidian";
import { SubscriptionSettingsTab } from "../settings/SubscriptionSettingsTab";
import KeepSidianPlugin from "main";

export interface NoteImportOptions {
	includeNotesTerms?: string[];
	excludeNotesTerms?: string[];
	updateTitle?: boolean;
	suggestTags?: boolean;
	maxTags?: number;
	tagPrefix?: string;
	limitToExistingTags?: boolean;
}

export class NoteImportOptionsModal extends Modal {
	private onSubmit: (options: NoteImportOptions) => void;
	private plugin: KeepSidianPlugin;
	constructor(
		app: App,
		plugin: KeepSidianPlugin,
		onSubmit: (options: NoteImportOptions) => void
	) {
		super(app);
		this.plugin = plugin;
		this.onSubmit = onSubmit;
	}

	async onOpen() {
		const { contentEl } = this;
		contentEl.createEl("h2", { text: "Import Options" });
		contentEl.createEl("p", {
			text: "Thanks for subscribing! Update the premium options for this import below.",
		});
		const premiumFeatureValues = {
			...this.plugin.settings.premiumFeatures,
		};
		SubscriptionSettingsTab.displayPremiumFeatures(
			contentEl,
			this.plugin,
			premiumFeatureValues,
			true
		);

		// Submit Button
		new Setting(contentEl)
			.addButton((btn) =>
				btn
					.setButtonText("Import")
					.setCta()
					.onClick(() => {
						this.onSubmit(premiumFeatureValues as NoteImportOptions);
						this.close();
					})
			)
			.addButton((btn) =>
				btn.setButtonText("Cancel").onClick(() => {
					this.close();
				})
			);
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
