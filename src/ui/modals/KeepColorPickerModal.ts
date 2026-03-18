import { App, Modal } from "obsidian";
import {
	formatKeepColorSummary,
	getEffectiveKeepColorValues,
	KEEP_COLOR_OPTIONS,
	normalizeKeepColorSelection,
} from "../../types/subscription";

interface KeepColorPickerModalOptions {
	selectedColors: string[];
	onSave: (selectedColors: string[]) => void;
}

export class KeepColorPickerModal extends Modal {
	private readonly onSave: (selectedColors: string[]) => void;
	private readonly workingSelection: Set<string>;
	private doneButtonEl: HTMLButtonElement | null = null;
	private helperTextEl: HTMLParagraphElement | null = null;

	constructor(app: App, options: KeepColorPickerModalOptions) {
		super(app);
		this.onSave = options.onSave;
		this.workingSelection = new Set(getEffectiveKeepColorValues(options.selectedColors));
	}

	onOpen(): void {
		const { contentEl, modalEl } = this;
		contentEl.empty();
		modalEl.classList.add("keepsidian-color-picker-modal-shell");
		contentEl.classList.add("keepsidian-color-picker-modal");

		contentEl.createEl("h2", { text: "Choose note colors" });
		contentEl.createEl("p", {
			text: "Pick the Google Keep colors you want to download.",
			cls: "keepsidian-color-picker-description",
		});

		const swatchGridEl = contentEl.createDiv({
			cls: "keepsidian-color-picker-grid",
		});
		for (const colorOption of KEEP_COLOR_OPTIONS) {
			const swatchButton = swatchGridEl.createEl("button", {
				cls: "keepsidian-color-picker-swatch",
				attr: {
					type: "button",
					"aria-label": colorOption.label,
				},
			});
			swatchButton.style.setProperty("--keepsidian-color-swatch", colorOption.hex);
			swatchButton.setAttribute("title", colorOption.label);
			swatchButton.dataset.keepColorValue = colorOption.value;
			swatchButton.addEventListener("click", () => {
				this.toggleColor(colorOption.value);
			});
		}

		this.helperTextEl = contentEl.createEl("p", {
			cls: "keepsidian-color-picker-helper",
		});

		const actionsEl = contentEl.createDiv({
			cls: "keepsidian-color-picker-actions",
		});
		const selectAllButton = actionsEl.createEl("button", {
			text: "Select all",
			attr: { type: "button" },
		});
		selectAllButton.addEventListener("click", () => {
			this.selectAll();
		});

		const clearAllButton = actionsEl.createEl("button", {
			text: "Clear all",
			attr: { type: "button" },
		});
		clearAllButton.addEventListener("click", () => {
			this.clearAll();
		});

		this.doneButtonEl = actionsEl.createEl("button", {
			text: "Done",
			cls: "mod-cta",
			attr: { type: "button" },
		});
		this.doneButtonEl.addEventListener("click", () => {
			this.finishSelection();
		});

		this.renderSelectionState();
	}

	onClose(): void {
		const { contentEl, modalEl } = this;
		contentEl.empty();
		contentEl.classList.remove("keepsidian-color-picker-modal");
		modalEl.classList.remove("keepsidian-color-picker-modal-shell");
	}

	private toggleColor(colorValue: string): void {
		if (this.workingSelection.has(colorValue)) {
			this.workingSelection.delete(colorValue);
		} else {
			this.workingSelection.add(colorValue);
		}
		this.renderSelectionState();
	}

	private selectAll(): void {
		for (const { value } of KEEP_COLOR_OPTIONS) {
			this.workingSelection.add(value);
		}
		this.renderSelectionState();
	}

	private clearAll(): void {
		this.workingSelection.clear();
		this.renderSelectionState();
	}

	private finishSelection(): void {
		if (this.workingSelection.size === 0) {
			return;
		}

		this.onSave(normalizeKeepColorSelection(this.workingSelection));
		this.close();
	}

	private renderSelectionState(): void {
		const selectedCount = this.workingSelection.size;
		for (const swatchButton of this.contentEl.querySelectorAll<HTMLElement>(
			".keepsidian-color-picker-swatch"
		)) {
			const colorValue = swatchButton.getAttribute("data-keep-color-value");
			const isSelected = !!colorValue && this.workingSelection.has(colorValue);
			swatchButton.classList.toggle("is-selected", isSelected);
			swatchButton.setAttribute("aria-pressed", String(isSelected));
		}

		if (this.doneButtonEl) {
			this.doneButtonEl.disabled = selectedCount === 0;
		}

		if (this.helperTextEl) {
			if (selectedCount === 0) {
				this.helperTextEl.textContent = "Select at least one color to continue.";
				this.helperTextEl.classList.add("is-warning");
			} else {
				this.helperTextEl.textContent = formatKeepColorSummary(
					normalizeKeepColorSelection(this.workingSelection)
				);
				this.helperTextEl.classList.remove("is-warning");
			}
		}
	}
}
