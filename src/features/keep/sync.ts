import { Notice, normalizePath } from 'obsidian';
import type KeepSidianPlugin from '../../main';
import { normalizeNote, PreNormalizedNote, extractFrontmatter } from '../../google/keep/note';
import { handleDuplicateNotes } from '../../google/keep/compare';
import { mergeNoteBodies } from '../../google/keep/merge';
import { processAttachments } from '../../google/keep/attachments';
import type { NoteImportOptions } from '../../components/NoteImportOptionsModal';
import {
  CONFLICT_FILE_SUFFIX,
  MEDIA_FOLDER_NAME,
  FRONTMATTER_KEEP_SIDIAN_LAST_SYNCED_DATE_KEY,
} from './constants';
import type {
  GoogleKeepImportResponse,
  PremiumFeatureFlags,
} from '../../integrations/server/keepApi';
import {
  fetchNotes as apiFetchNotes,
  fetchNotesWithPremiumFeatures as apiFetchNotesWithPremium,
} from '../../integrations/server/keepApi';

export interface SyncCallbacks {
  setTotalNotes?: (total: number) => void;
  reportProgress?: () => void;
}

async function importGoogleKeepNotesBase(
  plugin: KeepSidianPlugin,
  fetchFunction: (offset: number, limit: number) => Promise<GoogleKeepImportResponse>,
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
        if (typeof response.total_notes === 'number' && callbacks?.setTotalNotes) {
          try { callbacks.setTotalNotes(response.total_notes); } catch {}
        }
        if (!response.notes || response.notes.length === 0) {
          break;
        }
        await processAndSaveNotes(plugin, response.notes, callbacks);
        totalImported += response.notes.length;
        offset += limit;
      } catch (error) {
        console.error(`Error fetching notes at offset ${offset}:`, error);
        hasError = true;
        foundError = error as Error;
      }
    }

    if (foundError) {
      throw foundError;
    }

    new Notice('Imported Google Keep notes.');
    return totalImported;
  } catch (error) {
    console.error(error);
    new Notice('Failed to import notes.');
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
    (offset, limit) => apiFetchNotesWithPremium(email, token, featureFlags, offset, limit),
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
      prefix: options.tagPrefix || 'auto-',
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

  if (!(await plugin.app.vault.adapter.exists(saveLocation))) {
    await plugin.app.vault.createFolder(saveLocation);
  }

  const mediaFolder = `${saveLocation}/${MEDIA_FOLDER_NAME}`;
  if (!(await plugin.app.vault.adapter.exists(mediaFolder))) {
    await plugin.app.vault.createFolder(mediaFolder);
  }

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
  let noteFilePath = normalizePath(`${saveLocation}/${noteTitle}.md`);

  const lastSyncedDate = new Date().toISOString();

  const duplicateNotesAction = await handleDuplicateNotes(
    noteFilePath,
    normalizedNote,
    plugin.app
  );
  let mdFrontMatterDict = normalizedNote.frontmatterDict;
  let bodyToWrite = normalizedNote.body;

  if (duplicateNotesAction === 'skip') {
    return;
  } else if (duplicateNotesAction === 'rename') {
    const existingContent = await plugin.app.vault.adapter.read(noteFilePath);
    const [, existingBody, existingFrontMatterDict] = extractFrontmatter(existingContent);
    const { merged, hasConflict } = mergeNoteBodies(existingBody, bodyToWrite);
    if (!hasConflict) {
      bodyToWrite = merged;
      mdFrontMatterDict = existingFrontMatterDict;
    } else {
      noteFilePath = noteFilePath.replace(/\.md$/, '');
      noteFilePath = `${noteFilePath}${CONFLICT_FILE_SUFFIX}${lastSyncedDate}.md`;
    }
  }

  mdFrontMatterDict[FRONTMATTER_KEEP_SIDIAN_LAST_SYNCED_DATE_KEY] = lastSyncedDate;
  const mdFrontMatter = Object.entries(mdFrontMatterDict)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n');
  const mdContentWithSyncDate = `---\n${mdFrontMatter}\n---\n${bodyToWrite}`;

  await plugin.app.vault.adapter.write(noteFilePath, mdContentWithSyncDate);

  if (normalizedNote.blob_urls && normalizedNote.blob_urls.length > 0) {
    await processAttachments(plugin.app, normalizedNote.blob_urls, saveLocation);
  }
}

