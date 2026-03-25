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
	dirnameSafe,
	ensureFolder,
	ensureParentFolderForFile,
	mediaFolderPath,
	normalizePathSafe,
} from "@services/paths";
import { resolveNoteFolder, resolveNotePath } from "@services/note-path-resolver";
import { flushLogSync, logSync } from "@app/logging";
import type { GoogleKeepImportResponse, PremiumFeatureFlags, SyncFilters } from "@integrations/server/keepApi";
import type { DownloadScope, SyncPlan, SyncPlanEntry } from "@types";
import { NetworkError } from "@services/errors";
import {
	fetchNotes as apiFetchNotes,
	fetchNotesWithPremiumFeatures as apiFetchNotesWithPremium,
} from "@integrations/server/keepApi";
import { findExistingKeepNotePath } from "./domain/noteLookup";
import {
	buildExistingKeepNoteIndex,
	updateExistingKeepNoteIndex,
	type ExistingKeepNoteIndex,
} from "./domain/noteLookup";

const LAST_SUCCESSFUL_SYNC_DATE_KEY = "KeepSidianLastSuccessfulSyncDate";
const NOTE_LOG_BATCH_KEY = "sync:notes";
const NOTE_LOG_BATCH_SIZE = 50;
const FETCH_NOTES_PAGE_LIMIT = 100;
const FETCH_NOTES_MAX_ATTEMPTS = 3;
const FETCH_NOTES_INITIAL_RETRY_DELAY_MS = 2_000;
const FETCH_NOTES_RETRYABLE_STATUSES = new Set([429, 503]);
const NOTE_LOG_BATCH_OPTIONS = {
	batchKey: NOTE_LOG_BATCH_KEY,
	batchSize: NOTE_LOG_BATCH_SIZE,
} as const;

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
	const vault = plugin.app?.vault as { setConfig?: (configKey: string, configValue: unknown) => void } | undefined;
	if (vault?.setConfig) {
		try {
			vault.setConfig(key, value);
		} catch {
			/* empty */
		}
	}
}

export function getLastSuccessfulSyncDate(plugin: KeepSidianPlugin): string | undefined {
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

function parseCustomSinceDate(isoString: string): Date {
	const parsed = new Date(isoString);
	if (Number.isNaN(parsed.getTime())) {
		throw new Error("Choose a valid custom date before preparing the download review.");
	}
	if (parsed.getTime() > Date.now()) {
		throw new Error("Custom download dates must be in the past.");
	}
	return parsed;
}

export function buildDownloadSyncFilters(
	plugin: KeepSidianPlugin,
	downloadScope?: DownloadScope
): SyncFilters | undefined {
	const scope = downloadScope ?? { kind: "last-sync" };

	if (scope.kind === "all") {
		return undefined;
	}

	if (scope.kind === "custom-since") {
		const since = scope.since?.trim();
		if (!since) {
			throw new Error("Choose a custom date.");
		}
		return {
			changed_gt: parseCustomSinceDate(since).toISOString(),
		};
	}

	const lastSuccessfulSyncDate = getLastSuccessfulSyncDate(plugin);
	return lastSuccessfulSyncDate
		? {
				changed_gt: lastSuccessfulSyncDate,
			}
		: undefined;
}

export interface SyncCallbacks {
	setTotalNotes?: (total: number) => void;
	reportProgress?: () => void;
	reportPlanProgress?: (processed: number, total?: number) => void;
	onEntrySettled?: (entryId: string, success: boolean) => void;
}

interface FetchImportNotesResult {
	notes: PreNormalizedNote[];
	completionDate?: string;
}

export interface BuiltImportSyncPlan {
	plan: SyncPlan;
	notes: PreNormalizedNote[];
	noteEntryIds: string[];
	completionDate?: string;
}

function logErrorIfNotTest(...args: unknown[]) {
	try {
		const isTest =
			typeof process !== "undefined" && (process.env?.NODE_ENV === "test" || !!process.env?.JEST_WORKER_ID);
		if (!isTest) {
			console.error(...args);
		}
	} catch {
		// no-op
	}
}

function isRetryableFetchError(error: unknown): error is NetworkError {
	return error instanceof NetworkError && FETCH_NOTES_RETRYABLE_STATUSES.has(error.status ?? -1);
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchImportPageWithRetry(
	fetchFunction: (
		offset: number,
		limit: number,
		filters?: SyncFilters,
		cursor?: string
	) => Promise<GoogleKeepImportResponse>,
	offset: number,
	limit: number,
	filters?: SyncFilters,
	cursor?: string
): Promise<GoogleKeepImportResponse> {
	let retryDelayMs = FETCH_NOTES_INITIAL_RETRY_DELAY_MS;

	for (let attempt = 1; attempt <= FETCH_NOTES_MAX_ATTEMPTS; attempt++) {
		try {
			return await fetchFunction(offset, limit, filters, cursor);
		} catch (error) {
			if (!isRetryableFetchError(error) || attempt === FETCH_NOTES_MAX_ATTEMPTS) {
				throw error;
			}
			logErrorIfNotTest(
				`Rate limited while fetching notes at offset ${offset}; retrying in ${retryDelayMs}ms (attempt ${attempt}/${FETCH_NOTES_MAX_ATTEMPTS})`
			);
			await sleep(retryDelayMs);
			retryDelayMs *= 2;
		}
	}

	throw new Error("Retry loop exited unexpectedly");
}

async function fetchImportNotesBase(
	plugin: KeepSidianPlugin,
	fetchFunction: (
		offset: number,
		limit: number,
		filters?: SyncFilters,
		cursor?: string
	) => Promise<GoogleKeepImportResponse>,
	callbacks?: Pick<SyncCallbacks, "setTotalNotes" | "reportPlanProgress">,
	downloadScope?: DownloadScope
): Promise<FetchImportNotesResult> {
	try {
		let offset = 0;
		const limit = FETCH_NOTES_PAGE_LIMIT;
		let cursor: string | undefined;
		let usingCursorPagination = false;
		let hasError = false;
		let foundError: Error | null = null;
		let hasReportedTotal = false;
		const fetchedNotes: PreNormalizedNote[] = [];

		const syncFilters = buildDownloadSyncFilters(plugin, downloadScope);

		let completionDate: string | undefined;

		while (!hasError) {
			try {
				const response = await fetchImportPageWithRetry(
					fetchFunction,
					offset,
					limit,
					syncFilters,
					cursor
				);
				completionDate = new Date().toISOString();
				if (typeof response.total_notes === "number" && callbacks?.setTotalNotes && !hasReportedTotal) {
					try {
						callbacks.setTotalNotes(response.total_notes);
						hasReportedTotal = true;
					} catch {
						/* empty */
					}
				}
				if (!response.notes || response.notes.length === 0) {
					break;
				}
				fetchedNotes.push(...response.notes);
				callbacks?.reportPlanProgress?.(
					fetchedNotes.length,
					typeof response.total_notes === "number" ? response.total_notes : undefined
				);
				if (response.next_cursor) {
					cursor = response.next_cursor;
					usingCursorPagination = true;
				} else if (usingCursorPagination) {
					break;
				} else {
					offset += limit;
				}
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

		return {
			notes: fetchedNotes,
			completionDate,
		};
	} catch (error) {
		const normalizedError = error instanceof Error ? error : new Error(String(error));
		logErrorIfNotTest(normalizedError);
		throw normalizedError;
	}
}

function buildImportPlanEntry(
	plugin: KeepSidianPlugin,
	index: number,
	note: PreNormalizedNote,
	allowPerNoteSelection: boolean,
	selectionLockedReason?: string,
	existingKeepNoteIndex?: ExistingKeepNoteIndex
): Promise<SyncPlanEntry> {
	return (async () => {
		const normalizedNote = normalizeNote(note);
		const noteTitle = normalizedNote.title || `Untitled ${index + 1}`;
		const resolvedNotePath = resolveNotePath(plugin.app, plugin.settings, normalizedNote);
		const noteFilePath =
			(await findExistingKeepNotePath(
				plugin.app,
				normalizedNote,
				resolvedNotePath,
				existingKeepNoteIndex,
				plugin.settings.saveLocation
			)) ?? resolvedNotePath;
		const duplicateAction = noteTitle
			? await handleDuplicateNotes(
					plugin.settings.saveLocation,
					normalizedNote,
					plugin.app,
					noteFilePath,
					existingKeepNoteIndex
				)
			: "skip";

		let action: SyncPlanEntry["action"] = "skipped-identical";
		let label = "Skipped: identical";
		let selectable = false;
		let detail: string | undefined;

		switch (duplicateAction) {
			case "create":
				action = "create";
				label = "Create";
				selectable = true;
				break;
			case "overwrite":
				action = "overwrite";
				label = "Overwrite";
				selectable = true;
				break;
			case "merge": {
				const existingContent = await plugin.app.vault.adapter.read(noteFilePath).catch(() => "");
				const [, existingBody] = extractFrontmatter(existingContent);
				const { hasConflict } = mergeNoteText(existingBody, normalizedNote.textWithoutFrontmatter);
				action = hasConflict ? "conflict-copy" : "merge";
				label = hasConflict ? "Conflict copy" : "Merge";
				selectable = true;
				detail = hasConflict ? "Will create a conflict copy next to the existing note." : undefined;
				break;
			}
			case "skip":
			default:
				action = "skipped-identical";
				label = "Skipped: identical";
				selectable = false;
				break;
		}

		return {
			id: `import:${index}:${normalizePathSafe(noteFilePath)}`,
			mode: "import",
			stage: "import",
			title: noteTitle,
			path: normalizePathSafe(noteFilePath),
			action,
			label,
			selectable,
			selected: selectable,
			selectionLocked: selectable && !allowPerNoteSelection,
			selectionLockedReason: selectable && !allowPerNoteSelection ? selectionLockedReason : undefined,
			meta: detail ? { detail } : undefined,
		};
	})();
}

export async function buildImportSyncPlan(
	plugin: KeepSidianPlugin,
	options?: NoteImportOptions,
	allowPerNoteSelection = true,
	selectionLockedReason?: string,
	callbacks?: Pick<SyncCallbacks, "setTotalNotes" | "reportPlanProgress">,
	downloadScope?: DownloadScope
): Promise<BuiltImportSyncPlan> {
	const { email, token } = plugin.settings;
	const fetchFunction =
		options !== undefined
			? (offset: number, limit: number, filters?: SyncFilters, cursor?: string) =>
					apiFetchNotesWithPremium(email, token, convertOptionsToFeatureFlags(options), offset, limit, filters, cursor)
			: (offset: number, limit: number, filters?: SyncFilters, cursor?: string) =>
					apiFetchNotes(email, token, offset, limit, filters, cursor);
	const fetched = await fetchImportNotesBase(plugin, fetchFunction, callbacks, downloadScope);
	const existingKeepNoteIndex = await buildExistingKeepNoteIndex(plugin.app, plugin.settings.saveLocation);
	const entries = await Promise.all(
		fetched.notes.map((note, index) =>
			buildImportPlanEntry(plugin, index, note, allowPerNoteSelection, selectionLockedReason, existingKeepNoteIndex)
		)
	);
	const actionableEntries = entries.filter((entry) => entry.selectable);
	const counts = entries.reduce<Record<string, number>>((acc, entry) => {
		acc[entry.label] = (acc[entry.label] ?? 0) + 1;
		return acc;
	}, {});

	return {
		plan: {
			id: `import-plan:${Date.now()}`,
			mode: "import",
			stage: "import",
			generatedAt: Date.now(),
			title: "Review download changes",
			entries,
			counts,
			selectedCount: actionableEntries.length,
			actionableCount: actionableEntries.length,
		},
		notes: fetched.notes,
		noteEntryIds: entries.map((entry) => entry.id),
		completionDate: fetched.completionDate,
	};
}

export async function importSelectedGoogleKeepNotes(
	plugin: KeepSidianPlugin,
	notes: PreNormalizedNote[],
	callbacks?: SyncCallbacks,
	completionDate?: string,
	noteEntryIds?: string[]
): Promise<number> {
	await processAndSaveNotes(plugin, notes, callbacks, noteEntryIds);
	if (completionDate) {
		persistLastSuccessfulSyncDate(plugin, completionDate);
	}
	new Notice("Imported Google Keep notes.");
	return notes.length;
}

async function importGoogleKeepNotesBase(
	plugin: KeepSidianPlugin,
	fetchFunction: (
		offset: number,
		limit: number,
		filters?: SyncFilters,
		cursor?: string
	) => Promise<GoogleKeepImportResponse>,
	callbacks?: SyncCallbacks,
	downloadScope?: DownloadScope
): Promise<number> {
	try {
		const fetched = await fetchImportNotesBase(plugin, fetchFunction, callbacks, downloadScope);
		const imported = await importSelectedGoogleKeepNotes(plugin, fetched.notes, callbacks, fetched.completionDate);
		return imported;
	} catch (error) {
		new Notice("Failed to import notes.");
		throw error;
	}
}

export async function importGoogleKeepNotes(
	plugin: KeepSidianPlugin,
	callbacks?: SyncCallbacks,
	downloadScope?: DownloadScope
): Promise<number> {
	const { email, token } = plugin.settings;
	return await importGoogleKeepNotesBase(
		plugin,
		(offset, limit, filters, cursor) => apiFetchNotes(email, token, offset, limit, filters, cursor),
		callbacks,
		downloadScope
	);
}

export async function importGoogleKeepNotesWithOptions(
	plugin: KeepSidianPlugin,
	options: NoteImportOptions,
	callbacks?: SyncCallbacks,
	downloadScope?: DownloadScope
): Promise<number> {
	const featureFlags = convertOptionsToFeatureFlags(options);
	const { email, token } = plugin.settings;
	return await importGoogleKeepNotesBase(
		plugin,
		(offset, limit, filters, cursor) =>
			apiFetchNotesWithPremium(email, token, featureFlags, offset, limit, filters, cursor),
		callbacks,
		downloadScope
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

	const keepStateFilter: NonNullable<PremiumFeatureFlags["keep_state_filter"]> = {};
	if (options.includeColors && options.includeColors.length > 0) {
		keepStateFilter.colors = options.includeColors;
	}
	if (options.pinnedStatus && options.pinnedStatus !== "all") {
		keepStateFilter.pinned = options.pinnedStatus;
	}
	if (options.archivedStatus && options.archivedStatus !== "active-only") {
		keepStateFilter.archived = options.archivedStatus;
	}
	if (Object.keys(keepStateFilter).length > 0) {
		featureFlags.keep_state_filter = keepStateFilter;
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
	callbacks?: SyncCallbacks,
	noteEntryIds?: string[]
) {
	await ensurePascalCaseFrontmatter(plugin);
	const existingKeepNoteIndex = await buildExistingKeepNoteIndex(plugin.app, plugin.settings.saveLocation);

	try {
		for (const [index, note] of notes.entries()) {
			const normalizedNote = normalizeNote(note);
			const noteFolder = resolveNoteFolder(plugin.app, plugin.settings, normalizedNote);
			await ensureFolder(plugin.app, noteFolder);
			await ensureFolder(plugin.app, mediaFolderPath(noteFolder));
			const entryId = noteEntryIds?.[index];
			try {
				await processAndSaveNote(plugin, note, plugin.settings.saveLocation, normalizedNote, existingKeepNoteIndex);
				callbacks?.reportProgress?.();
				if (entryId) {
					callbacks?.onEntrySettled?.(entryId, true);
				}
			} catch (error: unknown) {
				if (entryId) {
					callbacks?.onEntrySettled?.(entryId, false);
				}
				throw error;
			}
		}
	} finally {
		await flushLogSync(plugin, { batchKey: NOTE_LOG_BATCH_KEY });
	}
}

export async function processAndSaveNote(
	plugin: KeepSidianPlugin,
	note: PreNormalizedNote,
	saveLocation: string,
	preNormalizedNote?: ReturnType<typeof normalizeNote>,
	existingKeepNoteIndex?: ExistingKeepNoteIndex
) {
	const normalizedNote = preNormalizedNote ?? normalizeNote(note);
	const noteTitle = normalizedNote.title;
	if (!noteTitle) {
		await logSync(plugin, "Skipped note without a title", NOTE_LOG_BATCH_OPTIONS);
		return;
	}
	const resolvedNotePath = resolveNotePath(plugin.app, plugin.settings, normalizedNote);
	let noteFilePath =
		(await findExistingKeepNotePath(
			plugin.app,
			normalizedNote,
			resolvedNotePath,
			existingKeepNoteIndex,
			saveLocation
		)) ?? resolvedNotePath;
	const noteLink = `[${noteTitle}](${normalizePathSafe(noteFilePath)})`;
	const noteFolder = dirnameSafe(noteFilePath);

	const lastSyncedDate = new Date().toISOString();

	try {
		const existedBefore = await plugin.app.vault.adapter.exists(noteFilePath);
		const duplicateNotesAction = await handleDuplicateNotes(
			saveLocation,
			normalizedNote,
			plugin.app,
			noteFilePath,
			existingKeepNoteIndex
		);
		const newFrontmatter = normalizedNote.frontmatter;
		const newTextWithoutFrontmatter = normalizedNote.textWithoutFrontmatter;

		if (duplicateNotesAction === "skip") {
			await logSync(plugin, `${noteLink} - identical (skipped)`, NOTE_LOG_BATCH_OPTIONS);
		} else if (duplicateNotesAction === "create") {
			const mdFrontmatter = buildFrontmatterWithSyncDate(newFrontmatter, lastSyncedDate);
			const newMdContent = wrapMarkdown(mdFrontmatter, newTextWithoutFrontmatter);
			await ensureParentFolderForFile(plugin.app, noteFilePath);
			await plugin.app.vault.adapter.write(noteFilePath, newMdContent);
			if (existingKeepNoteIndex) {
				updateExistingKeepNoteIndex(existingKeepNoteIndex, noteFilePath, normalizedNote);
			}
			await logSync(plugin, `${noteLink} - new file created`, NOTE_LOG_BATCH_OPTIONS);
		} else {
			const existingMarkdownFileContentRaw = await plugin.app.vault.adapter.read(noteFilePath);
			const existingMarkdownFileContent =
				typeof existingMarkdownFileContentRaw === "string" ? existingMarkdownFileContentRaw : "";
			const [existingFrontmatter, existingTextWithoutFrontmatter] = extractFrontmatter(existingMarkdownFileContent);

			const mdFrontmatter = buildFrontmatterWithSyncDate(existingFrontmatter, lastSyncedDate, newFrontmatter);

			if (duplicateNotesAction === "merge") {
				const { mergedText: mergedText, hasConflict } = mergeNoteText(
					existingTextWithoutFrontmatter,
					newTextWithoutFrontmatter
				);

				const mergedMdContent = wrapMarkdown(mdFrontmatter, mergedText);

				if (!hasConflict) {
					await ensureParentFolderForFile(plugin.app, noteFilePath);
					await plugin.app.vault.adapter.write(noteFilePath, mergedMdContent);
					if (existingKeepNoteIndex) {
						updateExistingKeepNoteIndex(existingKeepNoteIndex, noteFilePath, normalizedNote);
					}
					await logSync(plugin, `${noteLink} - merged (no conflict)`, NOTE_LOG_BATCH_OPTIONS);
				} else {
					// Write a conflict copy
					noteFilePath = noteFilePath.replace(/\.md$/, "");
					noteFilePath = `${noteFilePath}${CONFLICT_FILE_SUFFIX}${lastSyncedDate}.md`;

					await ensureParentFolderForFile(plugin.app, noteFilePath);
					await plugin.app.vault.adapter.write(noteFilePath, mergedMdContent);
					if (existingKeepNoteIndex) {
						updateExistingKeepNoteIndex(existingKeepNoteIndex, noteFilePath, normalizedNote);
					}
					const conflictLink = `[${noteTitle}](${normalizePathSafe(noteFilePath)})`;
					await logSync(plugin, `${conflictLink} - conflict copy created`, NOTE_LOG_BATCH_OPTIONS);
				}
			} else {
				const mdContentWithSyncDate = wrapMarkdown(mdFrontmatter, newTextWithoutFrontmatter);

				// overwrite path: write to current path
				await ensureParentFolderForFile(plugin.app, noteFilePath);
				await plugin.app.vault.adapter.write(noteFilePath, mdContentWithSyncDate);
				if (existingKeepNoteIndex) {
					updateExistingKeepNoteIndex(existingKeepNoteIndex, noteFilePath, normalizedNote);
				}
				await logSync(plugin, `${noteLink} - ${existedBefore ? "overwritten" : "created"}`, NOTE_LOG_BATCH_OPTIONS);
			}
		}

		if (normalizedNote.blob_urls && normalizedNote.blob_urls.length > 0) {
			if (noteFolder) {
				await ensureFolder(plugin.app, mediaFolderPath(noteFolder));
			}
			const { downloaded, skippedIdentical } = await processAttachments(
				plugin.app,
				normalizedNote.blob_urls,
				noteFolder || resolveNoteFolder(plugin.app, plugin.settings, normalizedNote),
				normalizedNote.blob_names
			);
			if (downloaded > 0) {
				const attachmentWord = downloaded === 1 ? "attachment" : "attachments";
				const skippedSuffix = skippedIdentical > 0 ? ` (${skippedIdentical} identical skipped)` : "";
				await logSync(
					plugin,
					`${noteLink} - downloaded ${downloaded} ${attachmentWord}${skippedSuffix}`,
					NOTE_LOG_BATCH_OPTIONS
				);
			} else if (skippedIdentical > 0) {
				const skippedWord = skippedIdentical === 1 ? "attachment" : "attachments";
				await logSync(
					plugin,
					`${noteLink} - attachments up to date (${skippedIdentical} ${skippedWord} identical)`,
					NOTE_LOG_BATCH_OPTIONS
				);
			}
		}
	} catch (err: unknown) {
		const errorMessage = err instanceof Error ? err.message : String(err);
		await flushLogSync(plugin, { batchKey: NOTE_LOG_BATCH_KEY });
		await logSync(plugin, `${noteLink} - error: ${errorMessage}`);
		throw err;
	}
}
