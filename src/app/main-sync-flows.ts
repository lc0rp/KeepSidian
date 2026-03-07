import { Notice } from "obsidian";
import type { DataAdapter } from "obsidian";
import type KeepSidianPlugin from "./main";
import type { NoteImportOptions } from "@ui/modals/NoteImportOptionsModal";
import { HIDDEN_CLASS } from "@app/ui-constants";
import { logSync, prepareSyncLog } from "@app/logging";
import {
	startSyncUI,
	finishSyncUI,
	setTotalNotes as uiSetTotalNotes,
	reportSyncProgress,
} from "@app/sync-ui";
import { importGoogleKeepNotes, importGoogleKeepNotesWithOptions } from "@features/keep/sync";
import { pushGoogleKeepNotes } from "@features/keep/push";
import { ensureFolder, normalizePathSafe } from "@services/paths";

type ErrorMessageResolver = (error: unknown) => string;

function resetProgressIndicatorsForNextStage(plugin: KeepSidianPlugin) {
	plugin.processedNotes = 0;
	plugin.totalNotes = null;
	if (plugin.statusTextEl) {
		plugin.statusTextEl.textContent = "Sync: 0/?";
	}
	if (plugin.progressContainerEl) {
		plugin.progressContainerEl.classList.remove(HIDDEN_CLASS);
		plugin.progressContainerEl.classList.remove("complete", "failed");
		if (!plugin.progressContainerEl.classList.contains("indeterminate")) {
			plugin.progressContainerEl.classList.add("indeterminate");
		}
	}
	plugin.progressBar?.setValue(0);
	plugin.progressModal?.setProgress(0, undefined);
}

export async function ensureStoragePathsOrThrow(plugin: KeepSidianPlugin): Promise<void> {
	const saveLocation = plugin.settings.saveLocation;
	try {
		await ensureFolder(plugin.app, saveLocation);
	} catch (error: unknown) {
		new Notice(`KeepSidian: failed to create save location: ${saveLocation}`);
		throw error;
	}
}

export async function runImportWithOptions(
	plugin: KeepSidianPlugin,
	options: NoteImportOptions,
	getErrorMessage: ErrorMessageResolver
): Promise<void> {
	try {
		await ensureStoragePathsOrThrow(plugin);
	} catch {
		return;
	}

	const logPrepared = await prepareSyncLog(plugin);
	if (!logPrepared) {
		return;
	}

	const batchOptions = {
		batchSize: 2,
		batchKey: "start-manual-sync",
	};
	await logSync(plugin, `\n\n---\n`, batchOptions);
	await logSync(plugin, `Manual sync started`, batchOptions);
	plugin.currentSyncMode = "import";
	startSyncUI(plugin);
	try {
		await importGoogleKeepNotesWithOptions(plugin, options, {
			setTotalNotes: (n) => uiSetTotalNotes(plugin, n),
			reportProgress: () => reportSyncProgress(plugin),
		});
		await logSync(
			plugin,
			`Manual sync ended - success. Processed ${plugin.processedNotes} note(s).`
		);
		finishSyncUI(plugin, true);
	} catch (error: unknown) {
		finishSyncUI(plugin, false);
		await logSync(
			plugin,
			`Manual sync ended - failed: ${getErrorMessage(error)}. Processed ${
				plugin.processedNotes
			} note(s).`
		);
	}
}

export async function runImportNotesFlow(
	plugin: KeepSidianPlugin,
	auto: boolean,
	getErrorMessage: ErrorMessageResolver
): Promise<void> {
	try {
		const isSubscriptionActive = await plugin.subscriptionService.isSubscriptionActive();
		(plugin as unknown as { subscriptionActive: boolean | null }).subscriptionActive =
			isSubscriptionActive;

		if (!auto && isSubscriptionActive) {
			await plugin.showImportOptionsModal();
			return;
		}

		try {
			await ensureStoragePathsOrThrow(plugin);
		} catch {
			return;
		}

		const logPrepared = await prepareSyncLog(plugin);
		if (!logPrepared) {
			return;
		}

		const batchOptions = { batchSize: 2, batchKey: "start-sync" };
		await logSync(plugin, `\n\n---\n`, batchOptions);
		await logSync(plugin, `${auto ? "Auto" : "Manual"} sync started`, batchOptions);
		plugin.currentSyncMode = "import";
		startSyncUI(plugin);
		try {
			await importGoogleKeepNotes(plugin, {
				setTotalNotes: (n) => uiSetTotalNotes(plugin, n),
				reportProgress: () => reportSyncProgress(plugin),
			});
			await logSync(
				plugin,
				`${auto ? "Auto" : "Manual"} sync ended - success. Processed ${
					plugin.processedNotes
				} note(s).`
			);
			finishSyncUI(plugin, true);
		} catch (error: unknown) {
			finishSyncUI(plugin, false);
			const errorMessage = getErrorMessage(error);
			await logSync(
				plugin,
				`${auto ? "Auto" : "Manual"} sync ended - failed: ${errorMessage}. Processed ${
					plugin.processedNotes
				} note(s).`
			);
		}
	} catch (error: unknown) {
		const errorMessage = getErrorMessage(error);
		await logSync(
			plugin,
			`${auto ? "Auto" : "Manual"} sync ended - failed: ${errorMessage}. Processed ${
				plugin.processedNotes
			} note(s).`
		);
	}
}

export async function runPushNotesFlow(
	plugin: KeepSidianPlugin,
	getErrorMessage: ErrorMessageResolver
): Promise<void> {
	try {
		try {
			await ensureStoragePathsOrThrow(plugin);
		} catch {
			return;
		}

		const logPrepared = await prepareSyncLog(plugin);
		if (!logPrepared) {
			return;
		}

		const batchOptions = { batchSize: 2, batchKey: "start-push-sync" };
		await logSync(plugin, `\n\n---\n`, batchOptions);
		await logSync(plugin, `Push sync started`, batchOptions);
		plugin.currentSyncMode = "push";
		startSyncUI(plugin);
		try {
			const pushed = await pushGoogleKeepNotes(plugin, {
				setTotalNotes: (n) => uiSetTotalNotes(plugin, n),
				reportProgress: () => reportSyncProgress(plugin),
			});
			await logSync(plugin, `Push sync ended - success. Pushed ${pushed} note(s).`);
			finishSyncUI(plugin, true);
		} catch (error: unknown) {
			finishSyncUI(plugin, false);
			const errorMessage = getErrorMessage(error);
			await logSync(
				plugin,
				`Push sync ended - failed: ${errorMessage}. Processed ${plugin.processedNotes} note(s).`
			);
		}
	} catch (error: unknown) {
		const errorMessage = getErrorMessage(error);
		await logSync(
			plugin,
			`Push sync ended - failed: ${errorMessage}. Processed ${plugin.processedNotes} note(s).`
		);
	}
}

export async function runTwoWaySyncFlow(
	plugin: KeepSidianPlugin,
	getErrorMessage: ErrorMessageResolver,
	onTwoWaySuccess: () => void
): Promise<void> {
	try {
		try {
			await ensureStoragePathsOrThrow(plugin);
		} catch {
			return;
		}

		const logPrepared = await prepareSyncLog(plugin);
		if (!logPrepared) {
			return;
		}

		const batchOptions = {
			batchSize: 2,
			batchKey: "start-2way-sync",
		};
		await logSync(plugin, `\n\n---\n`, batchOptions);
		await logSync(plugin, `Two-way sync started`, batchOptions);
		plugin.currentSyncMode = "two-way";
		startSyncUI(plugin);
		const callbacks = {
			setTotalNotes: (n: number) => uiSetTotalNotes(plugin, n),
			reportProgress: () => reportSyncProgress(plugin),
		};

		let importProcessed = 0;
		try {
			await importGoogleKeepNotes(plugin, callbacks);
			importProcessed = plugin.processedNotes;
			await logSync(
				plugin,
				`Two-way sync - import completed. Processed ${importProcessed} note(s).`
			);
		} catch (error: unknown) {
			finishSyncUI(plugin, false);
			const errorMessage = getErrorMessage(error);
			await logSync(
				plugin,
				`Two-way sync ended - import failed: ${errorMessage}. Processed ${
					plugin.processedNotes
				} note(s).`
			);
			return;
		}

		resetProgressIndicatorsForNextStage(plugin);
		await logSync(plugin, `Two-way sync - starting push stage`);

		try {
			const pushed = await pushGoogleKeepNotes(plugin, callbacks);
			await logSync(
				plugin,
				`Two-way sync ended - success. Imported ${importProcessed} note(s), pushed ${pushed} note(s).`
			);
			finishSyncUI(plugin, true);
			onTwoWaySuccess();
		} catch (error: unknown) {
			finishSyncUI(plugin, false);
			const errorMessage = getErrorMessage(error);
			await logSync(
				plugin,
				`Two-way sync ended - push failed: ${errorMessage}. Processed ${
					plugin.processedNotes
				} note(s).`
			);
		}
	} catch (error: unknown) {
		const errorMessage = getErrorMessage(error);
		await logSync(
			plugin,
			`Two-way sync ended - failed: ${errorMessage}. Processed ${plugin.processedNotes} note(s).`
		);
	}
}

export async function openLatestSyncLogFlow(plugin: KeepSidianPlugin): Promise<void> {
	const adapter: DataAdapter | null = plugin.app?.vault?.adapter ?? null;
	if (!adapter) {
		new Notice("KeepSidian: unable to open sync log.");
		return;
	}

	let logPath = plugin.lastSyncLogPath;
	const logsFolder = normalizePathSafe(`${plugin.settings.saveLocation}/_KeepSidianLogs`);

	if (!logPath) {
		if (typeof adapter.list === "function") {
			try {
				const { files } = await adapter.list(logsFolder);
				const markdownFiles = (files ?? [])
					.map((file: string) => {
						const normalized = normalizePathSafe(file);
						return normalized.startsWith(logsFolder)
							? normalized
							: normalizePathSafe(`${logsFolder}/${normalized.split("/").pop()}`);
					})
					.filter((file: string) => file.toLowerCase().endsWith(".md"));
				if (!markdownFiles.length) {
					new Notice("KeepSidian: no sync logs found.");
					return;
				}
				markdownFiles.sort();
				logPath = markdownFiles[markdownFiles.length - 1];
			} catch {
				new Notice("KeepSidian: failed to open sync log.");
				return;
			}
		} else {
			new Notice("KeepSidian: no sync logs found.");
			return;
		}
	}

	if (!logPath) {
		new Notice("KeepSidian: no sync logs found.");
		return;
	}

	const normalizedPath = normalizePathSafe(logPath);
	plugin.lastSyncLogPath = normalizedPath;
	plugin.settings.lastSyncLogPath = normalizedPath;

	if (typeof plugin.app?.workspace?.openLinkText === "function") {
		void plugin.app.workspace.openLinkText(normalizedPath, "", true);
	} else {
		new Notice("KeepSidian: unable to open sync log.");
	}
}
