import type KeepSidianPlugin from "@app/main";
import { appendLog } from "../services/logger";
import { ensureFile, normalizePathSafe } from "../services/paths";
import { Notice } from "obsidian";

/**
 * Prepare today's sync log file. Shows a Notice on failure and returns null.
 * Returns the normalized log file path on success.
 */
export async function prepareSyncLog(
	plugin: KeepSidianPlugin
): Promise<string | null> {
	const currentDate = new Date().toISOString();
	const syncLogFile = `${currentDate.slice(0, 10)}.md`;
	const logPath = normalizePathSafe(
		`${plugin.settings.saveLocation}/_KeepSidianLogs/${syncLogFile}`
	);

	try {
		await ensureFile(plugin.app, logPath);
		return logPath;
	} catch (e) {
		// Keep message text aligned with tests/UX expectations
		new Notice(`KeepSidian: Failed to create log file: ${logPath}`);
		return null;
	}
}

export async function logSync(plugin: KeepSidianPlugin, message: string) {
	// Ensure today's log file exists first
	const logPath = await prepareSyncLog(plugin);
	if (!logPath) return; // Notice already shown by prepareSyncLog

	// Prepend HH:MM (24h) to message
	const now = new Date();
	const hours = String(now.getHours()).padStart(2, "0");
	const minutes = String(now.getMinutes()).padStart(2, "0");
	const currentTime = `${hours}:${minutes}`;
	try {
		const raw = `${currentTime} ${message}`;
		const line = raw.trimStart().startsWith("-") ? `${raw}` : `- ${raw}`;
		await appendLog(plugin.app, logPath, `${line}\n`);
	} catch (e) {
		try {
			const isTest =
				typeof process !== "undefined" &&
				(process.env?.NODE_ENV === "test" ||
					!!process.env?.JEST_WORKER_ID);
			if (!isTest) {
				console.error("Failed to write sync log:", e);
			}
			// Always surface a user-facing error
			new Notice("KeepSidian: Failed to write sync log.");
		} catch {
			/* empty */
		}
	}
}
