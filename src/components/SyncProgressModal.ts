import { App, Modal as ObsidianModal } from 'obsidian';

class BaseModal extends (ObsidianModal as any || class {
    app: App;
    titleEl: HTMLElement = document.createElement('div');
    contentEl: HTMLElement;
    modalEl: HTMLElement = document.createElement('div');
    constructor(app: App) {
        this.app = app;
        this.contentEl = document.createElement('div');
        (this.contentEl as any).empty = function() { this.innerHTML = ''; };
        (this.contentEl as any).createEl = function(tag: string, options?: any) {
            const el = document.createElement(tag);
            if (options?.text) { el.textContent = options.text; }
            this.appendChild(el);
            return el;
        };
    }
    open() {}
    close() {}
}) {}

export class SyncProgressModal extends BaseModal {
    private progressWrapEl: HTMLDivElement;
    private progressBarEl: HTMLDivElement;
    private statusEl: HTMLElement;
    private onCloseCallback?: () => void;

    constructor(app: App, onClose?: () => void) {
        super(app);
        this.onCloseCallback = onClose;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.classList.add('keepsidian-modal');

        // Title
        const titleEl = contentEl.createEl('h2', { text: 'Sync Progress' });
        (titleEl as HTMLElement).classList.add('keepsidian-modal-title');

        // Progress bar (custom, indeterminate by default)
        this.progressWrapEl = contentEl.createEl('div') as HTMLDivElement;
        this.progressWrapEl.className = 'keepsidian-modal-progress indeterminate';
        this.progressBarEl = this.progressWrapEl.createEl('div') as HTMLDivElement;
        this.progressBarEl.className = 'keepsidian-modal-progress-bar';

        // Status text
        this.statusEl = contentEl.createEl('div', { text: 'Processed 0 notes' });
        (this.statusEl as HTMLElement).classList.add('keepsidian-modal-status');
        this.statusEl.setAttribute('aria-live', 'polite');

        // Close button
        const button = contentEl.createEl('button', { text: 'OK' });
        (button as HTMLElement).classList.add('mod-cta');
        button.addEventListener('click', () => this.close());
    }

    onClose() {
        this.contentEl.empty();
        if (this.onCloseCallback) {
            this.onCloseCallback();
        }
    }

    setProgress(processed: number, total?: number) {
        if (this.statusEl) {
            const msg = total && total > 0
                ? `Processed ${processed} of ${total} notes`
                : `Processed ${processed} notes`;
            if ((this.statusEl as any).setText) {
                (this.statusEl as any).setText(msg);
            } else {
                this.statusEl.textContent = msg;
            }
        }

        // If total is available, show determinate width; otherwise keep indeterminate animation
        if (this.progressWrapEl && this.progressBarEl) {
            if (total && total > 0) {
                const pct = Math.max(0, Math.min(100, Math.round((processed / total) * 100)));
                this.progressWrapEl.classList.remove('indeterminate');
                this.progressBarEl.style.width = pct + '%';
            } else {
                this.progressWrapEl.classList.add('indeterminate');
                this.progressBarEl.style.width = '';
            }
        }
    }

    setComplete(success: boolean, processed: number) {
        if (this.progressWrapEl) {
            this.progressWrapEl.classList.remove('indeterminate');
            this.progressWrapEl.classList.toggle('complete', !!success);
            this.progressWrapEl.classList.toggle('failed', !success);
            if (this.progressBarEl) {
                this.progressBarEl.style.width = '100%';
            }
        }
        if (this.statusEl) {
            const msg = success ? `Synced ${processed} notes` : 'Sync failed';
            if ((this.statusEl as any).setText) {
                (this.statusEl as any).setText(msg);
            } else {
                this.statusEl.textContent = msg;
            }
        }
    }
}
