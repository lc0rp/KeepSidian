import { Notice } from "obsidian";
import type KeepSidianPlugin from "@app/main";
import { normalizePathSafe } from "@services/paths";
import { logSync, flushLogSync } from "@app/logging";
import { buildFrontmatterWithSyncDate, wrapMarkdown } from "./frontmatter";
import { FRONTMATTER_GOOGLE_KEEP_URL_KEY } from "./constants";
import type { SyncCallbacks } from "./sync";
import { collectNotesToPush, roundDateToSeconds } from "./push/collectNotes";
import {
	pushNotes as apiPushNotes,
	PushNotePayload,
	PushNoteResult,
} from "@integrations/server/keepApi";

const SKIPPED_LOG_BATCH_SIZE = 50;
const PUSH_PAYLOAD_BATCH_SIZE = 20;
const NOTE_LOG_BATCH_SIZE = 20;

function mapResultsByPath(results?: PushNoteResult[]): Map<string, PushNoteResult> {
	const map = new Map<string, PushNoteResult>();
	if (!results) {
		return map;
	}
	for (const result of results) {
		if (!result?.path) {
			continue;
		}
		map.set(normalizePathSafe(result.path), result);
	}
	return map;
}

export async function pushGoogleKeepNotes(
	plugin: KeepSidianPlugin,
	callbacks?: SyncCallbacks
): Promise<number> {
	try {
		const { notesToPush, skippedNotes } = await collectNotesToPush(plugin);

		if (skippedNotes.length > 0) {
			for (const skipped of skippedNotes) {
				const fileName = skipped.path.split("/").pop() || skipped.path;
				const link = `[${fileName}](${normalizePathSafe(skipped.path)})`;
				const message =
					skipped.reason === "up-to-date" ? "up to date (skipped)" : skipped.reason;
				await logSync(plugin, `${link} - ${message}`, {
					batchKey: "push:skipped",
					batchSize: SKIPPED_LOG_BATCH_SIZE,
				});
			}
			await flushLogSync(plugin, { batchKey: "push:skipped" });
		}

		if (notesToPush.length === 0) {
			new Notice("No Google Keep notes to push.");
			return 0;
		}

		callbacks?.setTotalNotes?.(notesToPush.length);

		const { email, token } = plugin.settings;
		let successCount = 0;

		for (let index = 0; index < notesToPush.length; index += PUSH_PAYLOAD_BATCH_SIZE) {
			const batch = notesToPush.slice(index, index + PUSH_PAYLOAD_BATCH_SIZE);
			const payloadBatch: PushNotePayload[] = batch.map((note) => ({
				path: note.relativePath,
				title: note.title,
				content: note.content,
				attachments: note.attachments.length > 0 ? note.attachments : undefined,
			}));

			const response = await apiPushNotes(email, token, payloadBatch);
			const resultMap = mapResultsByPath(response?.results);

			const batchKey = "push:notes";
			const batchSize = NOTE_LOG_BATCH_SIZE;
			const batchOptions = { batchKey, batchSize };
			for (const note of batch) {
				try {
					const pushTimestamp = roundDateToSeconds(new Date()).toISOString();
					const normalizedPath = normalizePathSafe(note.relativePath);
					const result = resultMap.get(normalizedPath) ?? resultMap.get(note.relativePath);
					if (result && result.success === false) {
						const errorText = result.error || result.message || "failed";
						await flushLogSync(plugin, { batchKey });
						await logSync(
							plugin,
							`[${note.title}](${normalizePathSafe(
								note.fullPath
							)}) - push failed: ${errorText}`
						);
						continue;
					}

					// Update Google Keep URL if provided and changed
					if (result?.keep_url) {
						const normalizedKeepUrl = result.keep_url.trim();
						if (normalizedKeepUrl) {
							const keyPrefix = `${FRONTMATTER_GOOGLE_KEEP_URL_KEY}:`;
							const match = note.frontmatter.match(
								new RegExp(`^${FRONTMATTER_GOOGLE_KEEP_URL_KEY}:\\s*(.*)$`, "m")
							);
							const existingValue = match?.[1]?.trim();
							if (existingValue !== normalizedKeepUrl) {
								if (match) {
									note.frontmatter = note.frontmatter.replace(
										new RegExp(`^${FRONTMATTER_GOOGLE_KEEP_URL_KEY}:\\s*.*$`, "m"),
										`${keyPrefix} ${normalizedKeepUrl}`
									);
								} else {
									note.frontmatter = note.frontmatter
										? `${note.frontmatter}\n${keyPrefix} ${normalizedKeepUrl}`
										: `${keyPrefix} ${normalizedKeepUrl}`;
								}
							}
						}
					}

					const frontmatterWithSync = buildFrontmatterWithSyncDate(
						note.frontmatter,
						pushTimestamp
					);
					const updatedContent = wrapMarkdown(frontmatterWithSync, note.body);
					await plugin.app.vault.adapter.write(note.fullPath, updatedContent);

					const attachmentSuffix =
						note.updatedAttachmentNames.length > 0
							? ` (updated ${
									note.updatedAttachmentNames.length === 1
										? "1 attachment"
										: `${note.updatedAttachmentNames.length} attachments`
							  })`
							: "";

					await logSync(
						plugin,
						`[${note.title}](${normalizePathSafe(note.fullPath)}) - pushed${attachmentSuffix}`,
						batchOptions
					);
					for (const missing of note.missingAttachments) {
						await logSync(
							plugin,
							`[${note.title}](${normalizePathSafe(
								note.fullPath
							)}) - missing attachment ${missing}`,
							batchOptions
						);
					}
					successCount += 1;
				} catch (error: unknown) {
					await flushLogSync(plugin, { batchKey });
					await logSync(
						plugin,
						`[${note.title}](${normalizePathSafe(note.fullPath)}) - error: ${
							(error as Error).message
						}`
					);
				} finally {
					callbacks?.reportProgress?.();
				}
			}
			await flushLogSync(plugin, { batchKey: "push:notes" });
		}

		new Notice("Pushed Google Keep notes.");
		return successCount;
	} catch (error: unknown) {
		new Notice("Failed to push notes.");
		throw error;
	}
}
