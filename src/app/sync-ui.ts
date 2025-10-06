import { Menu, Notice, ProgressBarComponent } from "obsidian";
import type KeepSidianPlugin from "@app/main";
import { formatStatusBarText, formatStatusBarTooltip } from "@app/sync-status";
import type { LastSyncSummary } from "@types";
import { HIDDEN_CLASS } from "@app/ui-constants";

type StatusBarItemElement = HTMLElement & {
	setText?: (text: string) => void;
	createEl?: <K extends keyof HTMLElementTagNameMap>(
		tagName: K,
		options?: { cls?: string | string[]; text?: string }
	) => HTMLElementTagNameMap[K];
};

type MenuWithPositioning = Menu & {
	showAtMouseEvent?: (event: MouseEvent) => void;
	showAtPosition?: (position: { x: number; y: number }) => void;
};

type NoticeWithControls = Notice & {
	setMessage?: (message: string) => void;
	hide?: () => void;
};

function createMenuTitleWithHint(
	label: string,
	hint?: string
): string | DocumentFragment {
	if (!hint) {
		return label;
	}
	const fragment = document.createDocumentFragment();
	const labelEl = document.createElement("span");
	labelEl.textContent = label;
	fragment.appendChild(labelEl);
	const hintEl = document.createElement("span");
	hintEl.classList.add("keepsidian-menu-hint");
	hintEl.textContent = ` — ${hint}`;
	fragment.appendChild(hintEl);
	return fragment;
}

function hasSetText(element: HTMLElement | null): element is StatusBarItemElement & {
	setText: (text: string) => void;
} {
	return element !== null && typeof (element as StatusBarItemElement).setText === "function";
}

function getNoticeControls(notice: Notice | null): NoticeWithControls | null {
	return notice ? (notice as NoticeWithControls) : null;
}

function setStatusBarText(plugin: KeepSidianPlugin, text: string) {
	if (plugin.statusTextEl) {
		plugin.statusTextEl.textContent = text;
	} else if (hasSetText(plugin.statusBarItemEl)) {
		plugin.statusBarItemEl.setText(text);
	}
}

function setStatusBarTooltip(plugin: KeepSidianPlugin, tooltip: string) {
	if (plugin.statusBarItemEl) {
		plugin.statusBarItemEl.setAttribute("title", tooltip);
	}
}

function createStatusElement<K extends keyof HTMLElementTagNameMap>(
	parent: HTMLElement,
	tagName: K
): HTMLElementTagNameMap[K] {
	const maybeObsidianParent = parent as StatusBarItemElement;
	if (typeof maybeObsidianParent.createEl === "function") {
		return maybeObsidianParent.createEl(tagName);
	}
	throw new Error("Cannot create child element without a parent with createEl method");
}

function ensureStatusBarElements(plugin: KeepSidianPlugin) {
	if (!plugin.statusBarItemEl) {
		plugin.statusBarItemEl = plugin.addStatusBarItem();
		plugin.statusBarItemEl.addEventListener("click", (evt: MouseEvent) => {
			evt.preventDefault();
			showStatusMenu(plugin, evt);
		});
		plugin.statusBarItemEl.classList?.add("keepsidian-status");
	}

	if (!plugin.statusTextEl) {
		plugin.statusTextEl = createStatusElement(plugin.statusBarItemEl, "span");
		plugin.statusTextEl.className = "keepsidian-status-text";
	}

	if (!plugin.progressContainerEl) {
		plugin.progressContainerEl = createStatusElement(plugin.statusBarItemEl, "div");
		plugin.progressContainerEl.className = "keepsidian-progress indeterminate";
	}
	if (!plugin.progressBar && plugin.progressContainerEl) {
		plugin.progressBar = new ProgressBarComponent(plugin.progressContainerEl);
		plugin.progressBar.setValue(0);
	}
}

function showStatusMenu(plugin: KeepSidianPlugin, evt?: MouseEvent) {
	const menu = new Menu();
	const syncing = plugin.isSyncInProgress();
	const gateSnapshot = plugin.getTwoWayGateSnapshot();
	const gateHint = gateSnapshot.allowed ? undefined : gateSnapshot.reasons[0];

	menu.addItem((item) => {
		item.setTitle("KEEPSIDIAN").setDisabled(true);
	});
	menu.addSeparator();

	menu.addItem((item) => {
		item
			.setTitle(createMenuTitleWithHint("Two-way sync", gateHint))
			.setDisabled(syncing)
			.onClick(async () => {
				if (plugin.isSyncInProgress()) {
					return;
				}
				const gate = await plugin.requireTwoWaySafeguards();
				if (!gate.allowed) {
					plugin.showTwoWaySafeguardNotice(gate);
					return;
				}
				await plugin.performTwoWaySync();
			});
		if (!gateSnapshot.allowed) {
			item.setIcon("lock");
		}
	});

	menu.addItem((item) => {
		item.setTitle("Download from Google Keep")
			.setDisabled(syncing)
			.onClick(() => {
				plugin.importNotes();
			});
	});

	menu.addItem((item) => {
		item
			.setTitle(createMenuTitleWithHint("Upload to Google Keep", gateHint))
			.setDisabled(syncing)
			.onClick(async () => {
				if (plugin.isSyncInProgress()) {
					return;
				}
				const gate = await plugin.requireTwoWaySafeguards();
				if (!gate.allowed) {
					plugin.showTwoWaySafeguardNotice(gate);
					return;
				}
				await plugin.pushNotes();
			});
		if (!gateSnapshot.allowed) {
			item.setIcon("lock");
		}
	});

	if (!gateSnapshot.allowed) {
		menu.addItem((item) => {
			item
				.setTitle("Open beta settings…")
				.setIcon("settings")
				.onClick(() => {
					plugin.openTwoWaySettings();
				});
		});
	}

	menu.addItem((item) => {
		item.setTitle("Open sync log file").onClick(() => {
			plugin.openLatestSyncLog();
		});
	});

	menu.addSeparator();
	menu.addItem((item) => {
		item.setTitle("Sync progress...").onClick(() => {
			plugin.openSyncProgressModal();
		});
	});

	const positionedMenu = menu as MenuWithPositioning;
	if (evt && typeof positionedMenu.showAtMouseEvent === "function") {
		positionedMenu.showAtMouseEvent(evt);
	} else if (typeof positionedMenu.showAtPosition === "function") {
		const x = evt?.pageX ?? evt?.clientX ?? 0;
		const y = evt?.pageY ?? evt?.clientY ?? 0;
		positionedMenu.showAtPosition({ x, y });
	}
}

function getSummary(plugin: KeepSidianPlugin): LastSyncSummary | null {
	return plugin.lastSyncSummary ?? null;
}

export function initializeStatusBar(plugin: KeepSidianPlugin) {
	ensureStatusBarElements(plugin);
	updateStatusBarSummary(plugin);
	if (plugin.progressContainerEl) {
		plugin.progressContainerEl.classList.add(HIDDEN_CLASS);
		plugin.progressContainerEl.classList.remove("complete", "failed");
		plugin.progressContainerEl.classList.add("indeterminate");
	}
	if (plugin.progressBar) {
		plugin.progressBar.setValue(0);
	}
}

export function updateStatusBarSummary(plugin: KeepSidianPlugin) {
	ensureStatusBarElements(plugin);
	const summary = getSummary(plugin);
	setStatusBarText(plugin, formatStatusBarText(summary));
	setStatusBarTooltip(plugin, formatStatusBarTooltip(summary));
}

export function startSyncUI(plugin: KeepSidianPlugin) {
	plugin.processedNotes = 0;
	plugin.totalNotes = null;
	ensureStatusBarElements(plugin);

	if (plugin.progressContainerEl) {
		plugin.progressContainerEl.classList.remove(HIDDEN_CLASS);
		plugin.progressContainerEl.classList.remove("complete", "failed");
		if (!plugin.progressContainerEl.classList.contains("indeterminate")) {
			plugin.progressContainerEl.classList.add("indeterminate");
		}
	}
	plugin.progressBar?.setValue(0);

	setStatusBarText(plugin, "Sync: 0/?");
	setStatusBarTooltip(plugin, "KeepSidian syncing...");
	plugin.progressModal?.setProgress(0, undefined);

	plugin.progressNotice = new Notice("Syncing Google Keep Notes...", 0);
}

export function reportSyncProgress(plugin: KeepSidianPlugin) {
	plugin.processedNotes += 1;
	const total = plugin.totalNotes ?? undefined;
	const text =
		typeof total === "number"
			? `Sync: ${plugin.processedNotes}/${total}`
			: `Sync: ${plugin.processedNotes}`;
	setStatusBarText(plugin, text);
	setStatusBarTooltip(plugin, "KeepSidian syncing...");
	if (
		plugin.progressContainerEl &&
		plugin.progressBar &&
		typeof total === "number" &&
		total > 0
	) {
		const pct = Math.max(0, Math.min(100, Math.round((plugin.processedNotes / total) * 100)));
		plugin.progressContainerEl.classList.remove("indeterminate");
		plugin.progressBar.setValue(pct);
	}
	plugin.progressModal?.setProgress(plugin.processedNotes, total);
}

export function finishSyncUI(plugin: KeepSidianPlugin, success: boolean) {
	if (plugin.progressNotice) {
		const noticeControls = getNoticeControls(plugin.progressNotice);
		const setMessage = noticeControls?.setMessage;
		if (setMessage) {
			setMessage.call(
				noticeControls,
				success ? "Synced Google Keep Notes." : "Failed to sync Google Keep Notes."
			);
		}
		const hideNotice = noticeControls?.hide;
		if (hideNotice) {
			const delay = success ? 4000 : 10000;
			setTimeout(() => hideNotice.call(noticeControls), delay);
		}
	}
	const totalValue = plugin.totalNotes ?? undefined;
	const summary: LastSyncSummary = {
		timestamp: Date.now(),
		processedNotes: plugin.processedNotes,
		totalNotes: typeof totalValue === "number" && totalValue > 0 ? totalValue : null,
		success,
		mode: plugin.currentSyncMode ?? "import",
	};
	plugin.lastSyncSummary = summary;
	plugin.settings.lastSyncSummary = summary;
	updateStatusBarSummary(plugin);
	if (plugin.progressContainerEl) {
		plugin.progressContainerEl.toggleClass("complete", !!success);
		plugin.progressContainerEl.toggleClass("failed", !success);
		setTimeout(() => {
			if (plugin.progressContainerEl) {
				plugin.progressContainerEl.classList.add(HIDDEN_CLASS);
			}
		}, 3000);
	}
	plugin.progressModal?.setComplete(success, plugin.processedNotes);
	plugin.progressModal?.setIdleSummary(summary);
	void plugin.saveSettings();
}

export function setTotalNotes(plugin: KeepSidianPlugin, total: number) {
	if (typeof total !== "number" || total <= 0) return;
	plugin.totalNotes = total;
	setStatusBarText(plugin, `Sync: ${plugin.processedNotes}/${total}`);
	setStatusBarTooltip(plugin, "KeepSidian syncing...");
	if (plugin.progressContainerEl) {
		plugin.progressContainerEl.classList.remove("indeterminate");
	}
	if (plugin.progressBar) {
		const pct = Math.max(0, Math.min(100, Math.round((plugin.processedNotes / total) * 100)));
		plugin.progressBar.setValue(pct);
	}
	plugin.progressModal?.setProgress(plugin.processedNotes, total);
}
