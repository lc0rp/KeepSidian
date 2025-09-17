import { Notice } from "obsidian";
import type KeepSidianPlugin from "@app/main";
import {
	normalizeNote,
	PreNormalizedNote,
	extractFrontmatter,
} from "./domain/note";
import { handleDuplicateNotes } from "./domain/compare";
import { mergeNoteBodies } from "./domain/merge";
// Import via legacy google path so tests can spy on this module
import { processAttachments } from "../keep/io/attachments";
import type { NoteImportOptions } from "@ui/modals/NoteImportOptionsModal";
import {
	CONFLICT_FILE_SUFFIX,
	MEDIA_FOLDER_NAME,
	FRONTMATTER_KEEP_SIDIAN_LAST_SYNCED_DATE_KEY,
} from "./constants";
import {
	buildNotePath,
	ensureFolder,
	ensureParentFolderForFile,
	mediaFolderPath,
	normalizePathSafe,
} from "@services/paths";
import { logSync } from "@app/logging";
import type {
	GoogleKeepImportResponse,
	PremiumFeatureFlags,
} from "@integrations/server/keepApi";
import {
	fetchNotes as apiFetchNotes,
	fetchNotesWithPremiumFeatures as apiFetchNotesWithPremium,
} from "@integrations/server/keepApi";

export interface SyncCallbacks {
	setTotalNotes?: (total: number) => void;
	reportProgress?: () => void;
}

// Build a frontmatter string ensuring KeepSidianLastSyncedDate is present/updated.
function buildFrontmatterWithSyncDate(
	frontmatterDict: Record<string, string>,
	lastSyncedDate: string,
	existingFrontmatter?: string
): string {
	if (existingFrontmatter && existingFrontmatter.trim().length > 0) {
		if (
			existingFrontmatter.includes(
				`${FRONTMATTER_KEEP_SIDIAN_LAST_SYNCED_DATE_KEY}:`
			)
		) {
			const re = new RegExp(
				`${FRONTMATTER_KEEP_SIDIAN_LAST_SYNCED_DATE_KEY}:\\s*[^\\n]*`
			);
			return existingFrontmatter.replace(
				re,
				`${FRONTMATTER_KEEP_SIDIAN_LAST_SYNCED_DATE_KEY}: ${lastSyncedDate}`
			);
		}
		return `${existingFrontmatter}\n${FRONTMATTER_KEEP_SIDIAN_LAST_SYNCED_DATE_KEY}: ${lastSyncedDate}`;
	}

	frontmatterDict[FRONTMATTER_KEEP_SIDIAN_LAST_SYNCED_DATE_KEY] =
		lastSyncedDate;
	return Object.entries(frontmatterDict)
		.map(([key, value]) => `${key}: ${value}`)
		.join("\n");
}

function wrapMarkdown(frontmatter: string, body: string): string {
	return `---\n${frontmatter}\n---\n${body}`;
}

function logErrorIfNotTest(...args: any[]) {
	try {
		const isTest =
			typeof process !== "undefined" &&
			(process.env?.NODE_ENV === "test" || !!process.env?.JEST_WORKER_ID);
		if (!isTest) {
			// eslint-disable-next-line no-console
			console.error(...args);
		}
	} catch {
		// no-op
	}
}

async function importGoogleKeepNotesBase(
	plugin: KeepSidianPlugin,
	fetchFunction: (
		offset: number,
		limit: number
	) => Promise<GoogleKeepImportResponse>,
	callbacks?: SyncCallbacks
): Promise<number> {
	try {
		let offset = 0;
		const limit = 50;
		let hasError = false;
		let foundError: Error | null = null;
		let totalImported = 0;

		while (true && !hasError) {
			try {
				const response = await fetchFunction(offset, limit);
				if (
					typeof response.total_notes === "number" &&
					callbacks?.setTotalNotes
				) {
					try {
						callbacks.setTotalNotes(response.total_notes);
					} catch {}
				}
				if (!response.notes || response.notes.length === 0) {
					break;
				}
				await processAndSaveNotes(plugin, response.notes, callbacks);
				totalImported += response.notes.length;
				offset += limit;
			} catch (error) {
				logErrorIfNotTest(
					`Error fetching notes at offset ${offset}:`,
					error
				);
				hasError = true;
				foundError = error as Error;
			}
		}

		if (foundError) {
			throw foundError;
		}

		new Notice("Imported Google Keep notes.");
		return totalImported;
	} catch (error) {
		logErrorIfNotTest(error);
		new Notice("Failed to import notes.");
		throw error;
	}
}

export async function importGoogleKeepNotes(
	plugin: KeepSidianPlugin,
	callbacks?: SyncCallbacks
): Promise<number> {
	const { email, token } = plugin.settings;
	return await importGoogleKeepNotesBase(
		plugin,
		(offset, limit) => apiFetchNotes(email, token, offset, limit),
		callbacks
	);
}

export async function importGoogleKeepNotesWithOptions(
	plugin: KeepSidianPlugin,
	options: NoteImportOptions,
	callbacks?: SyncCallbacks
): Promise<number> {
	const featureFlags = convertOptionsToFeatureFlags(options);
	const { email, token } = plugin.settings;
	return await importGoogleKeepNotesBase(
		plugin,
		(offset, limit) =>
			apiFetchNotesWithPremium(email, token, featureFlags, offset, limit),
		callbacks
	);
}

export function convertOptionsToFeatureFlags(
	options: NoteImportOptions
): PremiumFeatureFlags {
	const featureFlags: PremiumFeatureFlags = {};

	if (options.includeNotesTerms && options.includeNotesTerms.length > 0) {
		featureFlags.filter_notes = {
			terms: options.includeNotesTerms,
		};
	}

	if (options.excludeNotesTerms && options.excludeNotesTerms.length > 0) {
		featureFlags.skip_notes = {
			terms: options.excludeNotesTerms,
		};
	}

	if (options.updateTitle) {
		featureFlags.suggest_title = {};
	}

	if (options.suggestTags) {
		featureFlags.suggest_tags = {
			max_tags: options.maxTags || 5,
			restrict_tags: options.limitToExistingTags || false,
			prefix: options.tagPrefix || "auto-",
		};
	}

	return featureFlags;
}

export async function processAndSaveNotes(
	plugin: KeepSidianPlugin,
	notes: PreNormalizedNote[],
	callbacks?: SyncCallbacks
) {
	const saveLocation = plugin.settings.saveLocation;
	await ensureFolder(plugin.app as any, saveLocation);
	await ensureFolder(plugin.app as any, mediaFolderPath(saveLocation));

	for (const note of notes) {
		await processAndSaveNote(plugin, note, saveLocation);
		callbacks?.reportProgress?.();
	}
}

export async function processAndSaveNote(
	plugin: KeepSidianPlugin,
	note: PreNormalizedNote,
	saveLocation: string
) {
	const normalizedNote = normalizeNote(note);
	const noteTitle = normalizedNote.title;
	if (!noteTitle) {
		await logSync(plugin, "Skipped note without a title");
		return;
	}
	let noteFilePath = buildNotePath(saveLocation, noteTitle);
	const noteLink = `[${noteTitle}](${normalizePathSafe(noteFilePath)})`;

	const lastSyncedDate = new Date().toISOString();

	try {
		const existedBefore = await plugin.app.vault.adapter.exists(
			noteFilePath
		);
		const duplicateNotesAction = await handleDuplicateNotes(
			saveLocation,
			normalizedNote,
			plugin.app
		);
		const newFrontmatterDict = normalizedNote.frontmatterDict;
		const newFrontmatter = normalizedNote.frontmatter;
		const newBody = normalizedNote.body;

		if (duplicateNotesAction === "skip") {
			await logSync(plugin, `${noteLink} - identical (skipped)`);
			return;
		} else if (duplicateNotesAction === "merge" && !existedBefore) {
			const mdFrontmatter = buildFrontmatterWithSyncDate(
				newFrontmatterDict,
				lastSyncedDate,
				newFrontmatter
			);
			const mdContentWithSyncDate = wrapMarkdown(mdFrontmatter, newBody);
			await ensureParentFolderForFile(plugin.app as any, noteFilePath);
			await plugin.app.vault.adapter.write(
				noteFilePath,
				mdContentWithSyncDate
			);
			await logSync(plugin, `${noteLink} - new file created`);
			return;
		} else {
			let existingFrontmatter = "";
			let existingBody = "";
			let existingFrontmatterDict: Record<string, string> | undefined;
			if (existedBefore) {
				const existingContent = await plugin.app.vault.adapter.read(
					noteFilePath
				);
				[existingFrontmatter, existingBody, existingFrontmatterDict] =
					extractFrontmatter(existingContent);
			}

			let mdFrontmatter = buildFrontmatterWithSyncDate(
				existingFrontmatterDict
					? existingFrontmatterDict
					: newFrontmatterDict,
				lastSyncedDate,
				existedBefore && existingFrontmatter
					? existingFrontmatter
					: newFrontmatter
			);

			if (duplicateNotesAction === "merge") {
				const { mergedBody, hasConflict } = mergeNoteBodies(
					existingBody,
					newBody
				);

				let mergedMdContentWithSyncDate = wrapMarkdown(
					mdFrontmatter,
					mergedBody
				);

				if (!hasConflict) {
					await ensureParentFolderForFile(
						plugin.app as any,
						noteFilePath
					);
					await plugin.app.vault.adapter.write(
						noteFilePath,
						mergedMdContentWithSyncDate
					);
					await logSync(plugin, `${noteLink} - merged (no conflict)`);
				} else {
					// Write a conflict copy
					noteFilePath = noteFilePath.replace(/\.md$/, "");
					noteFilePath = `${noteFilePath}${CONFLICT_FILE_SUFFIX}${lastSyncedDate}.md`;

					await ensureParentFolderForFile(plugin.app as any, noteFilePath);
					await plugin.app.vault.adapter.write(
						noteFilePath,
						mergedMdContentWithSyncDate
					);
					const conflictLink = `[${noteTitle}](${normalizePathSafe(
						noteFilePath
					)})`;
					await logSync(
						plugin,
						`${conflictLink} - conflict copy created`
					);
				}
			} else {
				let mdContentWithSyncDate = wrapMarkdown(
					mdFrontmatter,
					newBody
				);

				// overwrite path: write to current path
				await ensureParentFolderForFile(plugin.app as any, noteFilePath);
				await plugin.app.vault.adapter.write(
					noteFilePath,
					mdContentWithSyncDate
				);
				await logSync(
					plugin,
					`${noteLink} - ${existedBefore ? "overwritten" : "created"}`
				);
			}
		}

		if (normalizedNote.blob_urls && normalizedNote.blob_urls.length > 0) {
			await processAttachments(
				plugin.app,
				normalizedNote.blob_urls,
				saveLocation
			);
		}
	} catch (err: any) {
		await logSync(
			plugin,
			`${noteLink} - error: ${err?.message || String(err)}`
		);
		throw err;
	}
}
