import { Notice } from "obsidian";
import type { SyncProgressModal } from "../ui/modals/SyncProgressModal";
import type KeepSidianPlugin from "@app/main";

export function startSyncUI(plugin: KeepSidianPlugin) {
	plugin.processedNotes = 0;
	plugin.totalNotes = null;
	if (!plugin.statusBarItemEl) {
		plugin.statusBarItemEl = plugin.addStatusBarItem();
    plugin.statusBarItemEl.addEventListener("click", () => {
      if (!plugin.progressModal) {
        plugin.progressModal =
          new (require("../ui/modals/SyncProgressModal").SyncProgressModal)(
            plugin.app,
            () => {
              plugin.progressModal =
                null as unknown as SyncProgressModal;
            }
          );
      }
			if (plugin.progressModal) {
				plugin.progressModal.setProgress(
					plugin.processedNotes,
					plugin.totalNotes ?? undefined
				);
				plugin.progressModal.open();
			}
		});
		plugin.statusBarItemEl.setAttribute(
			"aria-label",
			"KeepSidian sync progress"
		);
		plugin.statusBarItemEl.setAttribute(
			"title",
			"KeepSidian sync progress"
		);

		if ((plugin.statusBarItemEl as any).classList) {
			(plugin.statusBarItemEl as any).classList.add("keepsidian-status");
		}

		plugin.statusTextEl = document.createElement("span");
		plugin.statusTextEl.className = "keepsidian-status-text";
		plugin.statusTextEl.textContent = "Sync: 0/?";
		if ((plugin.statusBarItemEl as any).appendChild) {
			(plugin.statusBarItemEl as any).appendChild(plugin.statusTextEl);
		} else if ((plugin.statusBarItemEl as any).setText) {
			(plugin.statusBarItemEl as any).setText("Sync: 0/?");
		}

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
	} else {
		if (!plugin.statusTextEl) {
			plugin.statusTextEl = document.createElement("span");
			plugin.statusTextEl.className = "keepsidian-status-text";
			if ((plugin.statusBarItemEl as any).appendChild) {
				(plugin.statusBarItemEl as any).appendChild(
					plugin.statusTextEl
				);
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
		plugin.progressContainerEl.style.display = "";
		plugin.progressContainerEl.classList.remove("complete", "failed");
		plugin.progressContainerEl.classList.add("indeterminate");
		if (plugin.progressBarEl) {
			plugin.progressBarEl.classList.remove("paused");
			plugin.progressBarEl.style.width = "";
		}
		plugin.statusTextEl.textContent = "Sync: 0/?";
	}

	plugin.progressNotice = new Notice("Syncing Google Keep Notes...", 0);
}

export function reportSyncProgress(plugin: KeepSidianPlugin) {
	plugin.processedNotes += 1;
	const total = plugin.totalNotes ?? undefined;
	if (plugin.statusTextEl) {
		plugin.statusTextEl.textContent = total
			? `Sync: ${plugin.processedNotes}/${total}`
			: `Sync: ${plugin.processedNotes}`;
	} else if (
		plugin.statusBarItemEl &&
		(plugin.statusBarItemEl as any).setText
	) {
		(plugin.statusBarItemEl as any).setText(
			total
				? `Sync: ${plugin.processedNotes}/${total}`
				: `Sync: ${plugin.processedNotes}`
		);
	}
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
	const total = plugin.totalNotes ?? undefined;
	if (plugin.statusTextEl) {
		plugin.statusTextEl.textContent = success
			? typeof total === "number"
				? `Synced ${plugin.processedNotes}/${total} notes`
				: `Synced ${plugin.processedNotes} notes`
			: "Sync failed";
	} else if (
		plugin.statusBarItemEl &&
		(plugin.statusBarItemEl as any).setText
	) {
		(plugin.statusBarItemEl as any).setText(
			success
				? typeof total === "number"
					? `Synced ${plugin.processedNotes}/${total} notes`
					: `Synced ${plugin.processedNotes} notes`
				: "Sync failed"
		);
	}
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
}

export function setTotalNotes(plugin: KeepSidianPlugin, total: number) {
	if (typeof total !== "number" || total <= 0) return;
	plugin.totalNotes = total;
	if (plugin.statusTextEl) {
		plugin.statusTextEl.textContent = `Sync: ${plugin.processedNotes}/${total}`;
	} else if (
		plugin.statusBarItemEl &&
		(plugin.statusBarItemEl as any).setText
	) {
		(plugin.statusBarItemEl as any).setText(
			`Sync: ${plugin.processedNotes}/${total}`
		);
	}
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
