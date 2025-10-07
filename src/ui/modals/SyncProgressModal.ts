import { App, Modal, ProgressBarComponent } from "obsidian";
import { formatModalSummary } from "@app/sync-status";
import type { LastSyncSummary } from "@types";

interface CreateElOptions {
	text?: string;
}

type MaybeObsidianElement = HTMLElement & {
	empty?: () => void;
	createEl?: <K extends keyof HTMLElementTagNameMap>(
		tagName: K,
		options?: CreateElOptions
	) => HTMLElementTagNameMap[K];
	setText?: (text: string) => void;
};

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
	const element = parent.createEl(tagName);
	if (options?.text) {
		element.textContent = options.text;
	}
	// parent.appendChild(element);
	return element;
};

const setElementText = (element: HTMLElement, text: string) => {
	const maybeObsidianElement = element as MaybeObsidianElement;
	if (typeof maybeObsidianElement.setText === "function") {
		maybeObsidianElement.setText(text);
		return;
	}
	element.textContent = text;
};

interface TwoWayGateState {
	allowed: boolean;
	reasons: string[];
}

interface SyncProgressModalOptions {
	onTwoWaySync: () => void | Promise<void>;
	onImportOnly: () => void | Promise<void>;
	onUploadOnly: () => void | Promise<void>;
	onOpenSyncLog: () => void | Promise<void>;
	onClose?: () => void;
	getTwoWayGate: () => TwoWayGateState;
	requireTwoWayGate: () => Promise<TwoWayGateState>;
	showTwoWayGateNotice: (result: TwoWayGateState) => void;
	openTwoWaySettings: () => void;
}

export class SyncProgressModal extends Modal {
	private progressContainerEl: HTMLDivElement | null = null;
	private progressBar: ProgressBarComponent | null = null;
	private statusEl: HTMLElement | null = null;
	private buttons: {
		twoWay: HTMLButtonElement | null;
		importOnly: HTMLButtonElement | null;
		uploadOnly: HTMLButtonElement | null;
		openLog: HTMLButtonElement | null;
	} = {
		twoWay: null,
		importOnly: null,
		uploadOnly: null,
		openLog: null,
	};
	private gateMessageEl: HTMLDivElement | null = null;
	private options: SyncProgressModalOptions;
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

		const titleEl = createChild(contentEl, "h2", { text: "Sync progress" });
		titleEl.classList.add("keepsidian-modal-title");

		this.progressContainerEl = createChild(contentEl, "div");
		this.progressContainerEl.className = "keepsidian-modal-progress indeterminate";
		this.progressBar = new ProgressBarComponent(this.progressContainerEl);
		this.progressBar.setValue(0);

		this.statusEl = createChild(contentEl, "div", {
			text: "No sync has been run yet.",
		});
		this.statusEl.classList.add("keepsidian-modal-status");
		this.statusEl?.setAttribute("aria-live", "polite");

		const actionsEl = createChild(contentEl, "div");
		actionsEl.classList.add("keepsidian-modal-actions");

		this.buttons.twoWay = this.createActionButton(actionsEl, "Two-way sync", async () => {
			const gate = await this.options.requireTwoWayGate();
			if (!gate.allowed) {
				this.options.showTwoWayGateNotice(gate);
				return;
			}
			await this.options.onTwoWaySync();
		});
		this.buttons.importOnly = this.createActionButton(
			actionsEl,
			"Download from Google Keep",
			async () => {
				await this.options.onImportOnly();
			}
		);
		this.buttons.uploadOnly = this.createActionButton(actionsEl, "Upload to Google Keep", async () => {
			const gate = await this.options.requireTwoWayGate();
			if (!gate.allowed) {
				this.options.showTwoWayGateNotice(gate);
				return;
			}
			await this.options.onUploadOnly();
		});
		this.buttons.openLog = this.createActionButton(actionsEl, "Open sync log", async () => {
			await this.options.onOpenSyncLog();
		});

		this.gateMessageEl = createChild(contentEl, "div");
		this.gateMessageEl.classList.add("keepsidian-modal-gate-message");
		this.gateMessageEl.setAttribute("aria-live", "polite");
		this.gateMessageEl.hidden = true;

		const closeButton = createChild(contentEl, "button", { text: "Close" });
		closeButton.classList.add("mod-cta");
		closeButton.addEventListener("click", () => this.close());

		this.applyState();
		this.updateActionStates();
	}

	onClose() {
		clearElement(this.contentEl);
		this.buttons = {
			twoWay: null,
			importOnly: null,
			uploadOnly: null,
			openLog: null,
		};
		this.progressBar = null;
		this.progressContainerEl = null;
		this.gateMessageEl = null;
		if (this.options.onClose) {
			this.options.onClose();
		}
	}

	setProgress(processed: number, total?: number) {
		this.isSyncing = true;
		this.processed = processed;
		this.total = total;
		this.summary = null;
		this.lastResult = null;
		this.applyState();
		this.updateActionStates();
	}

	setComplete(success: boolean, processed: number) {
		this.isSyncing = false;
		this.lastResult = { success, processed };
		this.applyState();
		this.updateActionStates();
	}

	setIdleSummary(summary: LastSyncSummary | null) {
		this.isSyncing = false;
		this.summary = summary;
		this.lastResult = null;
		this.applyState();
		this.updateActionStates();
	}

	private setStatusText(msg: string) {
		if (!this.statusEl) {
			return;
		}
		setElementText(this.statusEl, msg);
	}

	private applyState() {
		if (!this.progressContainerEl || !this.progressBar) {
			return;
		}
		if (this.isSyncing) {
			this.progressContainerEl.classList.remove("complete", "failed");
			if (typeof this.total === "number" && this.total > 0) {
				const pct = Math.max(
					0,
					Math.min(100, Math.round((this.processed / this.total) * 100))
				);
				this.progressContainerEl.classList.remove("indeterminate");
				this.progressBar.setValue(pct);
			} else {
				this.progressContainerEl.classList.add("indeterminate");
				this.progressBar.setValue(0);
			}
			const msg =
				typeof this.total === "number" && this.total > 0
					? `Processed ${this.processed} of ${this.total} notes`
					: `Processed ${this.processed} notes`;
			this.setStatusText(msg);
			return;
		}

		this.progressContainerEl.classList.remove("indeterminate");

		if (this.summary) {
			const { success, processedNotes, totalNotes } = this.summary;
			this.progressContainerEl.toggleClass("complete", !!success);
			this.progressContainerEl.toggleClass("failed", !success);
			if (typeof totalNotes === "number" && totalNotes > 0) {
				const pct = Math.max(
					0,
					Math.min(100, Math.round((processedNotes / totalNotes) * 100))
				);
				this.progressBar.setValue(pct);
			} else {
				this.progressBar.setValue(success ? 100 : 0);
			}
			this.setStatusText(formatModalSummary(this.summary));
			return;
		}

		if (this.lastResult) {
			this.progressContainerEl.toggleClass("complete", this.lastResult.success);
			this.progressContainerEl.toggleClass("failed", !this.lastResult.success);
			this.progressBar.setValue(100);
			const msg = this.lastResult.success
				? `Synced ${this.lastResult.processed} notes`
				: "Sync failed";
			this.setStatusText(msg);
			return;
		}

		this.progressContainerEl.classList.remove("complete", "failed");
		this.progressBar.setValue(0);
		this.setStatusText("No sync has been run yet.");
	}

	private updateActionStates() {
		const gate = this.options.getTwoWayGate();
		const uploadsBlockedByGate = !gate.allowed;
		const disableUploads = this.isSyncing || uploadsBlockedByGate;
		const tooltip = (() => {
			if (this.isSyncing && !uploadsBlockedByGate) {
				return "Sync in progress—please wait before starting another sync.";
			}
			if (uploadsBlockedByGate) {
				return gate.reasons.length
					? gate.reasons.join(" • ")
					: "Complete beta safeguards in settings.";
			}
			return null;
		})();
		if (this.buttons.twoWay) {
			this.buttons.twoWay.disabled = disableUploads;
			if (disableUploads) {
				this.buttons.twoWay.setAttribute("aria-disabled", "true");
				if (tooltip) {
					this.buttons.twoWay.title = tooltip;
				} else {
					this.buttons.twoWay.removeAttribute("title");
				}
			} else {
				this.buttons.twoWay.removeAttribute("aria-disabled");
				this.buttons.twoWay.removeAttribute("title");
			}
		}
		if (this.buttons.importOnly) {
			this.buttons.importOnly.disabled = this.isSyncing;
		}
		if (this.buttons.uploadOnly) {
			this.buttons.uploadOnly.disabled = disableUploads;
			if (disableUploads) {
				this.buttons.uploadOnly.setAttribute("aria-disabled", "true");
				if (tooltip) {
					this.buttons.uploadOnly.title = tooltip;
				} else {
					this.buttons.uploadOnly.removeAttribute("title");
				}
			} else {
				this.buttons.uploadOnly.removeAttribute("aria-disabled");
				this.buttons.uploadOnly.removeAttribute("title");
			}
		}
		if (this.buttons.openLog) {
			this.buttons.openLog.disabled = false;
		}
		this.updateGateMessage(gate);
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

	private updateGateMessage(gate: TwoWayGateState) {
		if (!this.gateMessageEl) {
			return;
		}
		clearElement(this.gateMessageEl);
		if (gate.allowed) {
			this.gateMessageEl.hidden = true;
			return;
		}
		this.gateMessageEl.hidden = false;
		const heading = createChild(this.gateMessageEl, "div", {
			text: "Uploads are locked until you complete the beta safeguards:",
		});
		heading.classList.add("keepsidian-modal-gate-heading");
		const list = createChild(this.gateMessageEl, "ul");
		for (const reason of gate.reasons) {
			createChild(list, "li", { text: reason });
		}
		const note = createChild(this.gateMessageEl, "p", {
			text: "Downloads remain available while safeguards are incomplete.",
		});
		note.classList.add("keepsidian-modal-gate-note");
		const actions = createChild(this.gateMessageEl, "div");
		actions.classList.add("keepsidian-modal-gate-actions");
		const openSettings = createChild(actions, "button", {
			text: "Open beta settings",
		});
		openSettings.type = "button";
		openSettings.classList.add("keepsidian-modal-gate-button");
		openSettings.addEventListener("click", () => {
			this.options.openTwoWaySettings();
		});
	}
}
