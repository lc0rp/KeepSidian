import { App, Modal, ProgressBarComponent } from "obsidian";
import { formatModalSummary } from "@app/sync-status";
import type { SyncMode, LastSyncSummary } from "@types";

interface CreateElOptions {
	text?: string;
	cls?: string | string[];
}

type MaybeObsidianElement = HTMLElement & {
	empty?: () => void;
	createEl?: <K extends keyof HTMLElementTagNameMap>(tagName: K, options?: CreateElOptions) => HTMLElementTagNameMap[K];
	setText?: (text: string) => void;
};

interface TwoWayGateState {
	allowed: boolean;
	reasons: string[];
}

interface SyncProgressModalOptions {
	onRunSync: (mode: SyncMode) => void | Promise<void>;
	onOpenSyncLog: () => void | Promise<void>;
	onClose?: () => void;
	getTwoWayGate: () => TwoWayGateState;
	requireTwoWayGate: () => Promise<TwoWayGateState>;
	showTwoWayGateNotice: (result: TwoWayGateState) => void;
	openTwoWaySettings: () => void;
	getCurrentMode: () => SyncMode | null;
	getCurrentPhaseLabel: () => string | null;
	isSupporterActive: () => Promise<boolean>;
	renderImportOptions: (containerEl: HTMLElement, isActive: boolean) => void | Promise<void>;
}

const clearElement = (element: HTMLElement) => {
	const maybeObsidianElement = element as MaybeObsidianElement;
	if (typeof maybeObsidianElement.empty === "function") {
		maybeObsidianElement.empty();
		return;
	}
	element.innerHTML = "";
};

const createChild = <K extends keyof HTMLElementTagNameMap>(
	parent: HTMLElement,
	tagName: K,
	options?: CreateElOptions
): HTMLElementTagNameMap[K] => {
	const maybeObsidianParent = parent as MaybeObsidianElement;
	if (typeof maybeObsidianParent.createEl === "function") {
		return maybeObsidianParent.createEl(tagName, options);
	}
	const element = document.createElement(tagName);
	if (options?.text) {
		element.textContent = options.text;
	}
	if (options?.cls) {
		const classes = Array.isArray(options.cls) ? options.cls : [options.cls];
		for (const className of classes) {
			element.classList.add(className);
		}
	}
	parent.appendChild(element);
	return element;
};

const setElementText = (element: HTMLElement | null, text: string) => {
	if (!element) {
		return;
	}
	const maybeObsidianElement = element as MaybeObsidianElement;
	if (typeof maybeObsidianElement.setText === "function") {
		maybeObsidianElement.setText(text);
		return;
	}
	element.textContent = text;
};

function modeLabel(mode: SyncMode): string {
	switch (mode) {
		case "push":
			return "Upload only";
		case "two-way":
			return "Two-way sync";
		case "import":
		default:
			return "Download only";
	}
}

function modeUsesDownload(mode: SyncMode): boolean {
	return mode !== "push";
}

function modeRequiresTwoWayGate(mode: SyncMode): boolean {
	return mode === "push" || mode === "two-way";
}

export class SyncProgressModal extends Modal {
	private progressContainerEl: HTMLDivElement | null = null;
	private progressBar: ProgressBarComponent | null = null;
	private titleElRef: HTMLHeadingElement | null = null;
	private phaseEl: HTMLDivElement | null = null;
	private statusEl: HTMLDivElement | null = null;
	private gateMessageEl: HTMLDivElement | null = null;
	private advancedContainerEl: HTMLDivElement | null = null;
	private importOptionsContainerEl: HTMLDivElement | null = null;
	private primaryButton: HTMLButtonElement | null = null;
	private advancedButton: HTMLButtonElement | null = null;
	private openLogButton: HTMLButtonElement | null = null;
	private modeButtons: Record<SyncMode, HTMLButtonElement | null> = {
		import: null,
		push: null,
		"two-way": null,
	};
	private options: SyncProgressModalOptions;
	private selectedMode: SyncMode = "import";
	private showAdvanced = false;
	private isSyncing = false;
	private processed = 0;
	private total: number | undefined;
	private lastResult: { success: boolean; processed: number } | null = null;
	private summary: LastSyncSummary | null = null;

	constructor(app: App, options: SyncProgressModalOptions) {
		super(app);
		this.options = options;
	}

	onOpen() {
		const { contentEl } = this;
		clearElement(contentEl);
		contentEl.classList.add("keepsidian-modal");

		this.titleElRef = createChild(contentEl, "h2", { text: "Sync center" });
		this.titleElRef.classList.add("keepsidian-modal-title");

		this.phaseEl = createChild(contentEl, "div");
		this.phaseEl.classList.add("keepsidian-modal-phase");

		this.progressContainerEl = createChild(contentEl, "div");
		this.progressContainerEl.className = "keepsidian-modal-progress indeterminate";
		this.progressBar = new ProgressBarComponent(this.progressContainerEl);
		this.progressBar.setValue(0);

		this.statusEl = createChild(contentEl, "div", {
			text: "No sync has been run yet.",
		});
		this.statusEl.classList.add("keepsidian-modal-status");
		this.statusEl.setAttribute("aria-live", "polite");

		const actionsEl = createChild(contentEl, "div");
		actionsEl.classList.add("keepsidian-modal-actions");

		this.primaryButton = this.createActionButton(actionsEl, "Sync now", async () => {
			await this.runSelectedMode();
		});
		this.primaryButton.classList.add("mod-cta", "keepsidian-modal-action--primary");

		this.openLogButton = this.createActionButton(actionsEl, "Open sync log", async () => {
			await this.options.onOpenSyncLog();
		});
		this.openLogButton.classList.add("keepsidian-modal-action--open-log");

		this.advancedButton = this.createActionButton(actionsEl, "Advanced", async () => {
			this.showAdvanced = !this.showAdvanced;
			await this.refreshUI();
		});
		this.advancedButton.classList.add("keepsidian-modal-action--advanced", "keepsidian-modal-action--dropdown");

		this.advancedContainerEl = createChild(contentEl, "div");
		this.advancedContainerEl.classList.add("keepsidian-sync-center-advanced");

		const modeSectionEl = createChild(this.advancedContainerEl, "div");
		modeSectionEl.classList.add("keepsidian-sync-center-mode-section");
		const modeLabelEl = createChild(modeSectionEl, "div", { text: "Mode" });
		modeLabelEl.classList.add("keepsidian-sync-center-mode-label");
		const modePickerEl = createChild(this.advancedContainerEl, "div");
		modePickerEl.classList.add("keepsidian-sync-center-modes");
		modePickerEl.setAttribute("role", "radiogroup");
		modePickerEl.setAttribute("aria-label", "Sync mode");
		modeSectionEl.appendChild(modePickerEl);

		this.modeButtons.import = this.createModeButton(modePickerEl, "import", "Download only");
		this.modeButtons.push = this.createModeButton(modePickerEl, "push", "Upload only");
		this.modeButtons["two-way"] = this.createModeButton(modePickerEl, "two-way", "Two-way sync");

		this.importOptionsContainerEl = createChild(this.advancedContainerEl, "div");
		this.importOptionsContainerEl.classList.add("keepsidian-sync-center-download-options");

		this.gateMessageEl = createChild(this.advancedContainerEl, "div");
		this.gateMessageEl.classList.add("keepsidian-modal-gate-message");
		this.gateMessageEl.setAttribute("aria-live", "polite");

		const closeButton = createChild(contentEl, "button", { text: "Close" });
		closeButton.addEventListener("click", () => this.close());

		void this.refreshUI();
	}

	onClose() {
		clearElement(this.contentEl);
		this.progressContainerEl = null;
		this.progressBar = null;
		this.titleElRef = null;
		this.phaseEl = null;
		this.statusEl = null;
		this.gateMessageEl = null;
		this.advancedContainerEl = null;
		this.importOptionsContainerEl = null;
		this.primaryButton = null;
		this.advancedButton = null;
		this.openLogButton = null;
		this.modeButtons = {
			import: null,
			push: null,
			"two-way": null,
		};
		this.options.onClose?.();
	}

	setSelectedMode(mode: SyncMode) {
		this.selectedMode = mode;
		void this.refreshUI();
	}

	async runSelectedMode() {
		if (this.isSyncing) {
			return;
		}
		if (modeRequiresTwoWayGate(this.selectedMode)) {
			const gate = await this.options.requireTwoWayGate();
			if (!gate.allowed) {
				this.options.showTwoWayGateNotice(gate);
				await this.refreshUI();
				return;
			}
		}
		await this.options.onRunSync(this.selectedMode);
	}

	setProgress(processed: number, total?: number) {
		this.isSyncing = true;
		this.processed = processed;
		this.total = total;
		this.summary = null;
		this.lastResult = null;
		void this.refreshUI();
	}

	setComplete(success: boolean, processed: number) {
		this.isSyncing = false;
		this.lastResult = { success, processed };
		void this.refreshUI();
	}

	setIdleSummary(summary: LastSyncSummary | null) {
		this.isSyncing = false;
		this.summary = summary;
		this.lastResult = null;
		void this.refreshUI();
	}

	private createActionButton(
		container: HTMLElement,
		label: string,
		onClick: () => void | Promise<void>
	): HTMLButtonElement {
		const button = createChild(container, "button", { text: label });
		button.type = "button";
		button.classList.add("keepsidian-modal-action");
		button.addEventListener("click", () => {
			void onClick();
		});
		return button;
	}

	private createModeButton(container: HTMLElement, mode: SyncMode, label: string): HTMLButtonElement {
		const button = this.createActionButton(container, "", async () => {
			this.selectedMode = mode;
			await this.refreshUI();
		});
		button.classList.add("keepsidian-sync-center-mode-button");
		button.setAttribute("role", "radio");
		const indicator = createChild(button, "span");
		indicator.classList.add("keepsidian-sync-center-mode-indicator");
		indicator.setAttribute("aria-hidden", "true");
		const labelEl = createChild(button, "span", { text: label });
		labelEl.classList.add("keepsidian-sync-center-mode-text");
		return button;
	}

	private async refreshUI() {
		this.updatePrimaryButton();
		this.updateProgressAndStatus();
		this.updateAdvancedVisibility();
		this.updateModeButtons();
		this.updateGateMessage();
		await this.updateImportOptions();
	}

	private updatePrimaryButton() {
		if (!this.primaryButton || !this.advancedButton || !this.openLogButton) {
			return;
		}
		this.primaryButton.disabled = this.isSyncing;
		this.advancedButton.disabled = false;
		this.openLogButton.disabled = false;
		this.primaryButton.textContent = this.summary || this.lastResult ? "Sync again" : "Sync now";
		this.advancedButton.textContent = "Advanced";
		this.advancedButton.setAttribute("aria-expanded", this.showAdvanced ? "true" : "false");
		this.advancedButton.classList.toggle("is-expanded", this.showAdvanced);
	}

	private updateProgressAndStatus() {
		if (!this.progressContainerEl || !this.progressBar) {
			return;
		}

		if (this.isSyncing) {
			const phaseLabel =
				this.options.getCurrentPhaseLabel() ??
				(this.options.getCurrentMode() ? modeLabel(this.options.getCurrentMode() as SyncMode) : "Syncing");
			this.progressContainerEl.classList.remove("complete", "failed");
			if (typeof this.total === "number" && this.total > 0) {
				const pct = Math.max(0, Math.min(100, Math.round((this.processed / this.total) * 100)));
				this.progressContainerEl.classList.remove("indeterminate");
				this.progressBar.setValue(pct);
				setElementText(this.statusEl, `Processed ${this.processed} of ${this.total} notes`);
			} else {
				this.progressContainerEl.classList.add("indeterminate");
				this.progressBar.setValue(0);
				setElementText(this.statusEl, `Processed ${this.processed} notes`);
			}
			setElementText(this.phaseEl, phaseLabel);
			return;
		}

		this.progressContainerEl.classList.remove("indeterminate");
		setElementText(this.phaseEl, this.summary ? "Last sync" : "");

		if (this.summary) {
			const { success, processedNotes, totalNotes } = this.summary;
			this.progressContainerEl.toggleClass("complete", !!success);
			this.progressContainerEl.toggleClass("failed", !success);
			if (typeof totalNotes === "number" && totalNotes > 0) {
				const pct = Math.max(0, Math.min(100, Math.round((processedNotes / totalNotes) * 100)));
				this.progressBar.setValue(pct);
			} else {
				this.progressBar.setValue(success ? 100 : 0);
			}
			setElementText(this.statusEl, formatModalSummary(this.summary));
			return;
		}

		if (this.lastResult) {
			this.progressContainerEl.toggleClass("complete", this.lastResult.success);
			this.progressContainerEl.toggleClass("failed", !this.lastResult.success);
			this.progressBar.setValue(100);
			setElementText(
				this.statusEl,
				this.lastResult.success
					? `Last ${modeLabel(this.selectedMode).toLowerCase()} completed. Synced ${this.lastResult.processed} notes.`
					: "Sync failed"
			);
			return;
		}

		this.progressContainerEl.classList.remove("complete", "failed");
		this.progressBar.setValue(0);
		setElementText(this.statusEl, "No sync has been run yet.");
	}

	private updateAdvancedVisibility() {
		if (!this.advancedContainerEl) {
			return;
		}
		this.advancedContainerEl.hidden = !this.showAdvanced;
	}

	private updateModeButtons() {
		for (const [mode, button] of Object.entries(this.modeButtons) as Array<[SyncMode, HTMLButtonElement | null]>) {
			if (!button) {
				continue;
			}
			button.disabled = this.isSyncing;
			button.classList.toggle("is-selected", this.selectedMode === mode);
			button.setAttribute("aria-checked", this.selectedMode === mode ? "true" : "false");
		}
	}

	private async updateImportOptions() {
		if (!this.importOptionsContainerEl) {
			return;
		}
		clearElement(this.importOptionsContainerEl);
		if (!this.showAdvanced || !modeUsesDownload(this.selectedMode)) {
			this.importOptionsContainerEl.hidden = true;
			return;
		}
		const isActive = await this.options.isSupporterActive();
		if (!isActive) {
			this.importOptionsContainerEl.hidden = true;
			return;
		}
		this.importOptionsContainerEl.hidden = false;
		const heading = createChild(this.importOptionsContainerEl, "h3", {
			text: "Download options",
		});
		heading.classList.add("keepsidian-sync-center-download-options-title");
		const copy = createChild(this.importOptionsContainerEl, "p", {
			text: "Thanks for supporting KeepSidian! Customize your download below.",
		});
		copy.classList.add("keepsidian-sync-center-download-options-copy");
		const optionsBody = createChild(this.importOptionsContainerEl, "div");
		optionsBody.classList.add("keepsidian-sync-center-download-options-body");
		await this.options.renderImportOptions(optionsBody, true);
	}

	private updateGateMessage() {
		if (!this.gateMessageEl) {
			return;
		}
		clearElement(this.gateMessageEl);
		if (!this.showAdvanced || !modeRequiresTwoWayGate(this.selectedMode)) {
			this.gateMessageEl.hidden = true;
			return;
		}
		const gate = this.options.getTwoWayGate();
		if (gate.allowed) {
			this.gateMessageEl.hidden = true;
			return;
		}

		this.gateMessageEl.hidden = false;
		const heading = createChild(this.gateMessageEl, "div", {
			text: "⚠️ Uploads are a beta feature. Follow the instructions below to enable them.",
		});
		heading.classList.add("keepsidian-modal-gate-heading");
		const list = createChild(this.gateMessageEl, "ul");
		for (const reason of gate.reasons) {
			createChild(list, "li", { text: reason });
		}
		const openSettings = createChild(this.gateMessageEl, "button", {
			text: "Open beta settings",
		});
		openSettings.type = "button";
		openSettings.addEventListener("click", () => {
			this.options.openTwoWaySettings();
		});
	}
}
