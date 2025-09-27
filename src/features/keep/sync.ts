import { Notice } from "obsidian";
import type KeepSidianPlugin from "@app/main";
import { normalizeNote, PreNormalizedNote, extractFrontmatter } from "./domain/note";
import { handleDuplicateNotes } from "./domain/compare";
import { mergeNoteText } from "./domain/merge";
// Import via legacy google path so tests can spy on this module
import { processAttachments } from "../keep/io/attachments";
import type { NoteImportOptions } from "@ui/modals/NoteImportOptionsModal";
import { CONFLICT_FILE_SUFFIX } from "./constants";
import { buildFrontmatterWithSyncDate, wrapMarkdown } from "./frontmatter";
import { ensurePascalCaseFrontmatter } from "./migrations/fixFrontmatterCasing";
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
	SyncFilters,
} from "@integrations/server/keepApi";
import {
	fetchNotes as apiFetchNotes,
	fetchNotesWithPremiumFeatures as apiFetchNotesWithPremium,
} from "@integrations/server/keepApi";

const LAST_SUCCESSFUL_SYNC_DATE_KEY = "KeepSidianLastSuccessfulSyncDate";

function getVaultConfig(plugin: KeepSidianPlugin, key: string): unknown {
	const vault = plugin.app?.vault as { getConfig?: (configKey: string) => unknown } | undefined;
	if (vault?.getConfig) {
		try {
			return vault.getConfig(key);
		} catch {
			/* empty */
		}
	}
	return undefined;
}

function setVaultConfig(plugin: KeepSidianPlugin, key: string, value: unknown): void {
	const vault = plugin.app?.vault as
		| { setConfig?: (configKey: string, configValue: unknown) => void }
		| undefined;
	if (vault?.setConfig) {
		try {
			vault.setConfig(key, value);
		} catch {
			/* empty */
		}
	}
}

function getLastSuccessfulSyncDate(plugin: KeepSidianPlugin): string | undefined {
	const fromSettings = plugin.settings.keepSidianLastSuccessfulSyncDate;
	if (typeof fromSettings === "string" && fromSettings.trim().length > 0) {
		return fromSettings;
	}

	const fromVault = getVaultConfig(plugin, LAST_SUCCESSFUL_SYNC_DATE_KEY);
	if (typeof fromVault === "string" && fromVault.trim().length > 0) {
		return fromVault;
	}

	return undefined;
}

function persistLastSuccessfulSyncDate(plugin: KeepSidianPlugin, isoString: string): void {
	plugin.settings.keepSidianLastSuccessfulSyncDate = isoString;
	setVaultConfig(plugin, LAST_SUCCESSFUL_SYNC_DATE_KEY, isoString);
}

export interface SyncCallbacks {
	setTotalNotes?: (total: number) => void;
	reportProgress?: () => void;
}

function logErrorIfNotTest(...args: unknown[]) {
	try {
		const isTest =
			typeof process !== "undefined" &&
			(process.env?.NODE_ENV === "test" || !!process.env?.JEST_WORKER_ID);
		if (!isTest) {
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
		limit: number,
		filters?: SyncFilters
	) => Promise<GoogleKeepImportResponse>,
	callbacks?: SyncCallbacks
): Promise<number> {
	try {
		let offset = 0;
		const limit = 50;
		let hasError = false;
		let foundError: Error | null = null;
		let totalImported = 0;

		const lastSuccessfulSyncDate = getLastSuccessfulSyncDate(plugin);
		const syncFilters: SyncFilters | undefined = lastSuccessfulSyncDate
			? {
					created_gt: lastSuccessfulSyncDate,
					updated_gt: lastSuccessfulSyncDate,
			  }
			: undefined;

		let completionDate: string | undefined;

		while (!hasError) {
			try {
				const response = await fetchFunction(offset, limit, syncFilters);
				completionDate = new Date().toISOString();
				if (typeof response.total_notes === "number" && callbacks?.setTotalNotes) {
					try {
						callbacks.setTotalNotes(response.total_notes);
					} catch {
						/* empty */
					}
				}
				if (!response.notes || response.notes.length === 0) {
					break;
				}
				await processAndSaveNotes(plugin, response.notes, callbacks);
				totalImported += response.notes.length;
				offset += limit;
			} catch (error) {
				const normalizedError = error instanceof Error ? error : new Error(String(error));
				logErrorIfNotTest(`Error fetching notes at offset ${offset}:`, normalizedError);
				hasError = true;
				foundError = normalizedError;
			}
		}

		if (foundError) {
			throw foundError;
		}

		if (completionDate) {
			persistLastSuccessfulSyncDate(plugin, completionDate);
		}

		new Notice("Imported Google Keep notes.");
		return totalImported;
	} catch (error) {
		const normalizedError = error instanceof Error ? error : new Error(String(error));
		logErrorIfNotTest(normalizedError);
		new Notice("Failed to import notes.");
		throw normalizedError;
	}
}

export async function importGoogleKeepNotes(
	plugin: KeepSidianPlugin,
	callbacks?: SyncCallbacks
): Promise<number> {
	const { email, token } = plugin.settings;
	return await importGoogleKeepNotesBase(
		plugin,
		(offset, limit, filters) => apiFetchNotes(email, token, offset, limit, filters),
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
		(offset, limit, filters) =>
			apiFetchNotesWithPremium(email, token, featureFlags, offset, limit, filters),
		callbacks
	);
}

export function convertOptionsToFeatureFlags(options: NoteImportOptions): PremiumFeatureFlags {
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
	await ensureFolder(plugin.app, saveLocation);
	await ensureFolder(plugin.app, mediaFolderPath(saveLocation));
	await ensurePascalCaseFrontmatter(plugin);

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
		const existedBefore = await plugin.app.vault.adapter.exists(noteFilePath);
		const duplicateNotesAction = await handleDuplicateNotes(
			saveLocation,
			normalizedNote,
			plugin.app
		);
		const newFrontmatter = normalizedNote.frontmatter;
		const newTextWithoutFrontmatter = normalizedNote.textWithoutFrontmatter;

		if (duplicateNotesAction === "skip") {
			await logSync(plugin, `${noteLink} - identical (skipped)`);
		} else if (duplicateNotesAction === "create") {
			const mdFrontmatter = buildFrontmatterWithSyncDate(newFrontmatter, lastSyncedDate);
			const newMdContent = wrapMarkdown(mdFrontmatter, newTextWithoutFrontmatter);
			await ensureParentFolderForFile(plugin.app, noteFilePath);
			await plugin.app.vault.adapter.write(noteFilePath, newMdContent);
			await logSync(plugin, `${noteLink} - new file created`);
		} else {
			const existingMarkdownFileContent = await plugin.app.vault.adapter.read(noteFilePath);
			const [existingFrontmatter, existingTextWithoutFrontmatter] = extractFrontmatter(
				existingMarkdownFileContent
			);

			const mdFrontmatter = buildFrontmatterWithSyncDate(
				existingFrontmatter,
				lastSyncedDate,
				newFrontmatter
			);

			if (duplicateNotesAction === "merge") {
				const { mergedText: mergedText, hasConflict } = mergeNoteText(
					existingTextWithoutFrontmatter,
					newTextWithoutFrontmatter
				);

				const mergedMdContent = wrapMarkdown(mdFrontmatter, mergedText);

				if (!hasConflict) {
					await ensureParentFolderForFile(plugin.app, noteFilePath);
					await plugin.app.vault.adapter.write(noteFilePath, mergedMdContent);
					await logSync(plugin, `${noteLink} - merged (no conflict)`);
				} else {
					// Write a conflict copy
					noteFilePath = noteFilePath.replace(/\.md$/, "");
					noteFilePath = `${noteFilePath}${CONFLICT_FILE_SUFFIX}${lastSyncedDate}.md`;

					await ensureParentFolderForFile(plugin.app, noteFilePath);
					await plugin.app.vault.adapter.write(noteFilePath, mergedMdContent);
					const conflictLink = `[${noteTitle}](${normalizePathSafe(noteFilePath)})`;
					await logSync(plugin, `${conflictLink} - conflict copy created`);
				}
			} else {
				const mdContentWithSyncDate = wrapMarkdown(
					mdFrontmatter,
					newTextWithoutFrontmatter
				);

				// overwrite path: write to current path
				await ensureParentFolderForFile(plugin.app, noteFilePath);
				await plugin.app.vault.adapter.write(noteFilePath, mdContentWithSyncDate);
				await logSync(plugin, `${noteLink} - ${existedBefore ? "overwritten" : "created"}`);
			}
		}

		if (normalizedNote.blob_urls && normalizedNote.blob_urls.length > 0) {
			const { downloaded, skippedIdentical } = await processAttachments(
				plugin.app,
				normalizedNote.blob_urls,
				saveLocation,
				normalizedNote.blob_names
			);
			if (downloaded > 0) {
				const attachmentWord = downloaded === 1 ? "attachment" : "attachments";
				const skippedSuffix =
					skippedIdentical > 0 ? ` (${skippedIdentical} identical skipped)` : "";
				await logSync(
					plugin,
					`${noteLink} - downloaded ${downloaded} ${attachmentWord}${skippedSuffix}`
				);
			} else if (skippedIdentical > 0) {
				const skippedWord = skippedIdentical === 1 ? "attachment" : "attachments";
				await logSync(
					plugin,
					`${noteLink} - attachments up to date (${skippedIdentical} ${skippedWord} identical)`
				);
			}
		}
	} catch (err: unknown) {
		const errorMessage = err instanceof Error ? err.message : String(err);
		await logSync(plugin, `${noteLink} - error: ${errorMessage}`);
		throw err;
	}
}
