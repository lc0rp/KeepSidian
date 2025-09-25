import { Menu, Notice } from "obsidian";
import type KeepSidianPlugin from "@app/main";
import { formatStatusBarText, formatStatusBarTooltip } from "@app/sync-status";
import type { LastSyncSummary } from "@types";

function setStatusBarText(plugin: KeepSidianPlugin, text: string) {
	if (plugin.statusTextEl) {
		plugin.statusTextEl.textContent = text;
	} else if (
		plugin.statusBarItemEl &&
		(plugin.statusBarItemEl as any).setText
	) {
		(plugin.statusBarItemEl as any).setText(text);
	}
}

function setStatusBarTooltip(plugin: KeepSidianPlugin, tooltip: string) {
	if (
		plugin.statusBarItemEl &&
		(plugin.statusBarItemEl as any).setAttribute
	) {
		plugin.statusBarItemEl.setAttribute("title", tooltip);
	}
}

function ensureStatusBarElements(plugin: KeepSidianPlugin) {
	if (!plugin.statusBarItemEl) {
		plugin.statusBarItemEl = plugin.addStatusBarItem();
		plugin.statusBarItemEl.addEventListener("click", (evt: MouseEvent) => {
			evt.preventDefault();
			showStatusMenu(plugin, evt);
		});
		if ((plugin.statusBarItemEl as any).classList) {
			(plugin.statusBarItemEl as any).classList.add("keepsidian-status");
		}
	}

	if (!plugin.statusTextEl) {
		plugin.statusTextEl = document.createElement("span");
		plugin.statusTextEl.className = "keepsidian-status-text";
		if ((plugin.statusBarItemEl as any).appendChild) {
			(plugin.statusBarItemEl as any).appendChild(plugin.statusTextEl);
		}
	}

	if (!plugin.progressContainerEl) {
		plugin.progressContainerEl = document.createElement("div");
		plugin.progressContainerEl.className =
			"keepsidian-progress indeterminate";
		plugin.progressBarEl = document.createElement("div");
		plugin.progressBarEl.className = "keepsidian-progress-bar";
		plugin.progressContainerEl.appendChild(plugin.progressBarEl);
		if ((plugin.statusBarItemEl as any).appendChild) {
			(plugin.statusBarItemEl as any).appendChild(
				plugin.progressContainerEl
			);
		}
	}
}

function showStatusMenu(plugin: KeepSidianPlugin, evt?: MouseEvent) {
	const menu = new Menu();
	const syncing = plugin.isSyncInProgress();

	menu.addItem((item) => {
		item.setTitle("KEEPSIDIAN").setDisabled(true);
	});
	menu.addSeparator();

	menu.addItem((item) => {
		item.setTitle("Two-way sync")
			.setDisabled(syncing)
			.onClick(() => {
				plugin.performTwoWaySync();
			});
	});

	menu.addItem((item) => {
		item.setTitle("Import only")
			.setDisabled(syncing)
			.onClick(() => {
				plugin.importNotes();
			});
	});

	menu.addItem((item) => {
		item.setTitle("Upload only")
			.setDisabled(syncing)
			.onClick(() => {
				plugin.pushNotes();
			});
	});

	menu.addItem((item) => {
		item.setTitle("Open sync log").onClick(() => {
			plugin.openLatestSyncLog();
		});
	});

	menu.addSeparator();
	menu.addItem((item) => {
		item.setTitle("Sync progress...").onClick(() => {
			plugin.openSyncProgressModal();
		});
	});

	if (typeof (menu as any).showAtMouseEvent === "function" && evt) {
		(menu as any).showAtMouseEvent(evt);
	} else if (typeof (menu as any).showAtPosition === "function") {
		const x = evt?.pageX ?? evt?.clientX ?? 0;
		const y = evt?.pageY ?? evt?.clientY ?? 0;
		(menu as any).showAtPosition({ x, y });
	}
}

function getSummary(plugin: KeepSidianPlugin): LastSyncSummary | null {
	return plugin.lastSyncSummary ?? null;
}

export function initializeStatusBar(plugin: KeepSidianPlugin) {
	ensureStatusBarElements(plugin);
	updateStatusBarSummary(plugin);
	if (plugin.progressContainerEl) {
		plugin.progressContainerEl.style.display = "none";
		plugin.progressContainerEl.classList.remove("complete", "failed");
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
		plugin.progressContainerEl.style.display = "";
		plugin.progressContainerEl.classList.remove("complete", "failed");
		if (!plugin.progressContainerEl.classList.contains("indeterminate")) {
			plugin.progressContainerEl.classList.add("indeterminate");
		}
	}
	if (plugin.progressBarEl) {
		plugin.progressBarEl.classList.remove("paused");
		plugin.progressBarEl.style.width = "";
	}

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
		plugin.progressBarEl &&
		typeof total === "number" &&
		total > 0
	) {
		plugin.progressContainerEl.classList.remove("indeterminate");
		const pct = Math.max(
			0,
			Math.min(100, Math.round((plugin.processedNotes / total) * 100))
		);
		plugin.progressBarEl.style.width = pct + "%";
	}
	plugin.progressModal?.setProgress(plugin.processedNotes, total);
}

export function finishSyncUI(plugin: KeepSidianPlugin, success: boolean) {
	if (plugin.progressNotice) {
		const setter = (plugin.progressNotice as any).setMessage;
		if (typeof setter === "function") {
			setter.call(
				plugin.progressNotice,
				success
					? "Synced Google Keep Notes."
					: "Failed to sync Google Keep Notes."
			);
		}
		const hider = (plugin.progressNotice as any).hide;
		if (typeof hider === "function") {
			const delay = success ? 4000 : 10000;
			setTimeout(() => hider.call(plugin.progressNotice), delay);
		}
	}
	const totalValue = plugin.totalNotes ?? undefined;
	const summary: LastSyncSummary = {
		timestamp: Date.now(),
		processedNotes: plugin.processedNotes,
		totalNotes:
			typeof totalValue === "number" && totalValue > 0
				? totalValue
				: null,
		success,
		mode: plugin.currentSyncMode ?? "import",
	};
	plugin.lastSyncSummary = summary;
	plugin.settings.lastSyncSummary = summary;
	updateStatusBarSummary(plugin);
	if (plugin.progressContainerEl) {
		plugin.progressContainerEl.classList.toggle("complete", !!success);
		plugin.progressContainerEl.classList.toggle("failed", !success);
		setTimeout(() => {
			if (plugin.progressContainerEl) {
				plugin.progressContainerEl.style.display = "none";
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
	if (plugin.progressBarEl) {
		const pct = Math.max(
			0,
			Math.min(100, Math.round((plugin.processedNotes / total) * 100))
		);
		plugin.progressBarEl.style.width = pct + "%";
	}
	plugin.progressModal?.setProgress(plugin.processedNotes, total);
}
