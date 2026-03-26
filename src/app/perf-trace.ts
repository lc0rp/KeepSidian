import type KeepSidianPlugin from "@app/main";
import { ensureParentFolderForFile, normalizePathSafe } from "@services/paths";
import { resolveLogBaseFolder } from "@services/note-path-resolver";

const TEMP_SAVE_LOCATION_PATTERN = /(^|\/)KeepSidianTemp/i;

function shouldWritePerfTrace(plugin: KeepSidianPlugin): boolean {
	const saveLocation = normalizePathSafe(plugin.settings.saveLocation ?? "");
	return TEMP_SAVE_LOCATION_PATTERN.test(saveLocation);
}

function getTracePath(plugin: KeepSidianPlugin): string {
	return normalizePathSafe(
		`${resolveLogBaseFolder(plugin.app, plugin.settings)}/_KeepSidianLogs/perf-trace.ndjson`
	);
}

export async function appendPerfTrace(
	plugin: KeepSidianPlugin,
	event: string,
	data: Record<string, unknown> = {}
): Promise<void> {
	if (!shouldWritePerfTrace(plugin)) {
		return;
	}

	const tracePath = getTracePath(plugin);
	const line = `${JSON.stringify({ ts: new Date().toISOString(), event, ...data })}\n`;

	try {
		await ensureParentFolderForFile(plugin.app, tracePath);
		if (typeof plugin.app.vault.adapter.append === "function") {
			await plugin.app.vault.adapter.append(tracePath, line);
			return;
		}

		const existing = (await plugin.app.vault.adapter.exists(tracePath))
			? await plugin.app.vault.adapter.read(tracePath)
			: "";
		await plugin.app.vault.adapter.write(tracePath, `${existing}${line}`);
	} catch (error) {
		try {
			console.error("KeepSidian perf trace failed", error);
		} catch {
			/* empty */
		}
	}
}
