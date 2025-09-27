import { App, Modal as ObsidianModal } from "obsidian";
import { formatModalSummary } from "@app/sync-status";
import type { LastSyncSummary } from "@types";

interface ModalInstance {
	app: App;
	titleEl: HTMLElement;
	contentEl: HTMLElement;
	modalEl: HTMLElement;
	open(): void;
	close(): void;
}

type ModalConstructor = new (app: App) => ModalInstance;

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
	const element = document.createElement(tagName);
	if (options?.text) {
		element.textContent = options.text;
	}
	parent.appendChild(element);
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

const ModalFallback: ModalConstructor = class ModalFallbackImpl
	implements ModalInstance
{
	app: App;
	titleEl: HTMLElement = document.createElement("div");
	contentEl: HTMLElement = document.createElement("div");
	modalEl: HTMLElement = document.createElement("div");
	constructor(app: App) {
		this.app = app;
	}
	open() {}
	close() {}
};

const ModalBaseClass =
	(ObsidianModal as unknown as ModalConstructor | undefined) || ModalFallback;

class BaseModal extends ModalBaseClass {
	constructor(app: App) {
		super(app);
	}
}

interface SyncProgressModalCallbacks {
	onTwoWaySync: () => void;
	onImportOnly: () => void;
	onUploadOnly: () => void;
	onOpenSyncLog: () => void;
	onClose?: () => void;
}

export class SyncProgressModal extends BaseModal {
	private progressWrapEl: HTMLDivElement | null = null;
	private progressBarEl: HTMLDivElement | null = null;
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
	private callbacks: SyncProgressModalCallbacks;
	private isSyncing = false;
	private processed = 0;
	private total: number | undefined;
	private lastResult: { success: boolean; processed: number } | null = null;
	private summary: LastSyncSummary | null = null;

	constructor(app: App, callbacks: SyncProgressModalCallbacks) {
		super(app);
		this.callbacks = callbacks;
	}

	onOpen() {
		const { contentEl } = this;
		clearElement(contentEl);
		contentEl.classList.add("keepsidian-modal");

		const titleEl = createChild(contentEl, "h2", { text: "Sync progress" });
		titleEl.classList.add("keepsidian-modal-title");

		this.progressWrapEl = createChild(contentEl, "div");
		this.progressWrapEl.className = "keepsidian-modal-progress indeterminate";
		this.progressBarEl = createChild(this.progressWrapEl, "div");
		this.progressBarEl.className = "keepsidian-modal-progress-bar";

		this.statusEl = createChild(contentEl, "div", {
			text: "No sync has been run yet.",
		});
		this.statusEl.classList.add("keepsidian-modal-status");
		this.statusEl?.setAttribute("aria-live", "polite");

		const actionsEl = createChild(contentEl, "div");
		actionsEl.classList.add("keepsidian-modal-actions");

		this.buttons.twoWay = this.createActionButton(
			actionsEl,
			"Two-way sync",
			this.callbacks.onTwoWaySync
		);
		this.buttons.importOnly = this.createActionButton(
			actionsEl,
			"Download from Google Keep",
			this.callbacks.onImportOnly
		);
		this.buttons.uploadOnly = this.createActionButton(
			actionsEl,
			"Upload to Google Keep",
			this.callbacks.onUploadOnly
		);
		this.buttons.openLog = this.createActionButton(
			actionsEl,
			"Open sync log",
			this.callbacks.onOpenSyncLog
		);

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
		if (this.callbacks.onClose) {
			this.callbacks.onClose();
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
		if (!this.progressWrapEl || !this.progressBarEl) {
			return;
		}
		if (this.isSyncing) {
			this.progressWrapEl.classList.remove("complete", "failed");
			if (typeof this.total === "number" && this.total > 0) {
				const pct = Math.max(
					0,
					Math.min(100, Math.round((this.processed / this.total) * 100))
				);
				this.progressWrapEl.classList.remove("indeterminate");
				this.progressBarEl.style.width = pct + "%";
			} else {
				this.progressWrapEl.classList.add("indeterminate");
				this.progressBarEl.style.width = "";
			}
			const msg =
				typeof this.total === "number" && this.total > 0
					? `Processed ${this.processed} of ${this.total} notes`
					: `Processed ${this.processed} notes`;
			this.setStatusText(msg);
			return;
		}

		this.progressWrapEl.classList.remove("indeterminate");

		if (this.summary) {
			const { success, processedNotes, totalNotes } = this.summary;
			this.progressWrapEl.classList.toggle("complete", !!success);
			this.progressWrapEl.classList.toggle("failed", !success);
			if (typeof totalNotes === "number" && totalNotes > 0) {
				const pct = Math.max(
					0,
					Math.min(100, Math.round((processedNotes / totalNotes) * 100))
				);
				this.progressBarEl.style.width = pct + "%";
			} else {
				this.progressBarEl.style.width = success ? "100%" : "0%";
			}
			this.setStatusText(formatModalSummary(this.summary));
			return;
		}

		if (this.lastResult) {
			this.progressWrapEl.classList.toggle("complete", this.lastResult.success);
			this.progressWrapEl.classList.toggle("failed", !this.lastResult.success);
			this.progressBarEl.style.width = "100%";
			const msg = this.lastResult.success
				? `Synced ${this.lastResult.processed} notes`
				: "Sync failed";
			this.setStatusText(msg);
			return;
		}

		this.progressWrapEl.classList.remove("complete", "failed");
		this.progressBarEl.style.width = "";
		this.setStatusText("No sync has been run yet.");
	}

	private updateActionStates() {
		const disable = this.isSyncing;
		if (this.buttons.twoWay) {
			this.buttons.twoWay.disabled = disable;
		}
		if (this.buttons.importOnly) {
			this.buttons.importOnly.disabled = disable;
		}
		if (this.buttons.uploadOnly) {
			this.buttons.uploadOnly.disabled = disable;
		}
		if (this.buttons.openLog) {
			this.buttons.openLog.disabled = false;
		}
	}

	private createActionButton(
		container: HTMLElement,
		label: string,
		onClick: () => void
	): HTMLButtonElement {
		const button = createChild(container, "button", { text: label });
		button.type = "button";
		button.classList.add("keepsidian-modal-action");
		button.addEventListener("click", () => onClick());
		return button;
	}
}
