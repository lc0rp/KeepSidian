import { App, Modal as ObsidianModal } from 'obsidian';
import { formatModalSummary } from '@app/sync-status';
import type { LastSyncSummary } from '@types';

class BaseModal extends (ObsidianModal as any || class {
    app: App;
    titleEl: HTMLElement = document.createElement('div');
    contentEl: HTMLElement;
    modalEl: HTMLElement = document.createElement('div');
    constructor(app: App) {
        this.app = app;
        this.contentEl = document.createElement('div');
        (this.contentEl as HTMLDivElement).empty = function() { this.innerHTML = ''; };
        (this.contentEl as any).createEl = function(tag: string, options?: any) {
            const el = document.createElement(tag);
            if (options?.text) { el.textContent = options.text; }
            this.appendChild(el);
            return el;
        };
    }
    open() {}
    close() {}
}) {
    constructor(app: App) {
        // Ensure TS knows our super accepts an argument while remaining runtime-safe
        super(app as any);
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
                contentEl.empty();
                contentEl.classList.add("keepsidian-modal");

                const titleEl = (contentEl as any).createEl
                        ? (contentEl as any).createEl("h2", { text: "Sync Progress" })
                        : (() => {
                                  const el = document.createElement("h2");
                                  el.textContent = "Sync Progress";
                                  contentEl.appendChild(el);
                                  return el;
                          })();
                (titleEl as HTMLElement).classList.add("keepsidian-modal-title");

                this.progressWrapEl = (contentEl as any).createEl
                        ? ((contentEl as any).createEl("div") as HTMLDivElement)
                        : (() => {
                                  const el = document.createElement("div");
                                  contentEl.appendChild(el);
                                  return el as HTMLDivElement;
                          })();
                this.progressWrapEl.className = "keepsidian-modal-progress indeterminate";
                this.progressBarEl = (this.progressWrapEl as any).createEl
                        ? ((this.progressWrapEl as any).createEl("div") as HTMLDivElement)
                        : (() => {
                                  const el = document.createElement("div");
                                  this.progressWrapEl!.appendChild(el);
                                  return el as HTMLDivElement;
                          })();
                this.progressBarEl.className = "keepsidian-modal-progress-bar";

                this.statusEl = (contentEl as any).createEl
                        ? (contentEl as any).createEl("div", { text: "No sync has been run yet." })
                        : (() => {
                                  const el = document.createElement("div");
                                  el.textContent = "No sync has been run yet.";
                                  contentEl.appendChild(el);
                                  return el;
                          })();
                (this.statusEl as HTMLElement).classList.add("keepsidian-modal-status");
                this.statusEl?.setAttribute("aria-live", "polite");

                const actionsEl = (contentEl as any).createEl
                        ? (contentEl as any).createEl("div")
                        : (() => {
                                  const el = document.createElement("div");
                                  contentEl.appendChild(el);
                                  return el;
                          })();
                (actionsEl as HTMLElement).classList.add("keepsidian-modal-actions");

                this.buttons.twoWay = this.createActionButton(
                        actionsEl,
                        "Two-way sync",
                        this.callbacks.onTwoWaySync
                );
                this.buttons.importOnly = this.createActionButton(
                        actionsEl,
                        "Import only",
                        this.callbacks.onImportOnly
                );
                this.buttons.uploadOnly = this.createActionButton(
                        actionsEl,
                        "Upload only",
                        this.callbacks.onUploadOnly
                );
                this.buttons.openLog = this.createActionButton(
                        actionsEl,
                        "Open sync log",
                        this.callbacks.onOpenSyncLog
                );

                const closeButton = (contentEl as any).createEl
                        ? (contentEl as any).createEl("button", { text: "Close" })
                        : (() => {
                                  const el = document.createElement("button");
                                  el.textContent = "Close";
                                  contentEl.appendChild(el);
                                  return el;
                          })();
                (closeButton as HTMLElement).classList.add("mod-cta");
                closeButton.addEventListener("click", () => this.close());

                this.applyState();
                this.updateActionStates();
        }

        onClose() {
                this.contentEl.empty();
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
                if ((this.statusEl as any).setText) {
                        (this.statusEl as any).setText(msg);
                } else {
                        this.statusEl.textContent = msg;
                }
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
                const button = (container as any).createEl
                        ? (container as any).createEl("button", { text: label })
                        : (() => {
                                  const el = document.createElement("button");
                                  el.textContent = label;
                                  container.appendChild(el);
                                  return el;
                          })();
                button.type = "button";
                button.addEventListener("click", () => onClick());
                return button as HTMLButtonElement;
        }
}
