import { App } from "obsidian";
import { NormalizedNote, normalizeDate, extractFrontmatter } from "./note";
import {
	FRONTMATTER_GOOGLE_KEEP_CREATED_DATE_KEY,
	FRONTMATTER_GOOGLE_KEEP_UPDATED_DATE_KEY,
	FRONTMATTER_KEEP_SIDIAN_LAST_SYNCED_DATE_KEY,
} from "../constants";

interface UpdatedFileInfo {
	content: string;
	createdDate: Date | null;
	updatedDate: Date | null;
}

interface ExistingFileInfo {
	content: string;
	createdDate: Date | null;
	updatedDate: Date | null;
	fsCreatedDate: Date | null;
	fsUpdatedDate: Date | null;
	lastSyncedDate: Date | null;
}

function getUpdatedFileInfo(incomingNote: NormalizedNote): UpdatedFileInfo {
	return {
		content: incomingNote.body,
		createdDate: incomingNote.created,
		updatedDate: incomingNote.updated,
	};
}

async function getExistingFileInfo(
	noteFilePath: string,
	app: App
): Promise<ExistingFileInfo> {
	const existingContent = await app.vault.adapter.read(noteFilePath);
	const [, existingBody, existingFrontMatterDict] =
		extractFrontmatter(existingContent);

	const existingCreatedDate = normalizeDate(
		existingFrontMatterDict[FRONTMATTER_GOOGLE_KEEP_CREATED_DATE_KEY]
	);
	const existingUpdatedDate = normalizeDate(
		existingFrontMatterDict[FRONTMATTER_GOOGLE_KEEP_UPDATED_DATE_KEY]
	);
	const existingLastSyncedDate = normalizeDate(
		existingFrontMatterDict[FRONTMATTER_KEEP_SIDIAN_LAST_SYNCED_DATE_KEY]
	);
	// Get fsCreatedDate and fsUpdatedDate from noteFilePath
	const fsCreatedDateTimeStamp = await app.vault.adapter
		.stat(noteFilePath)
		.then((stat) => stat?.ctime);
	const fsUpdatedDateTimeStamp = await app.vault.adapter
		.stat(noteFilePath)
		.then((stat) => stat?.mtime);
	const fsCreatedDate = fsCreatedDateTimeStamp
		? new Date(fsCreatedDateTimeStamp)
		: null;
	const fsUpdatedDate = fsUpdatedDateTimeStamp
		? new Date(fsUpdatedDateTimeStamp)
		: null;

	return {
		// Read from noteFilePath
		content: existingBody,
		createdDate: existingCreatedDate,
		updatedDate: existingUpdatedDate,
		fsCreatedDate: fsCreatedDate,
		fsUpdatedDate: fsUpdatedDate,
		lastSyncedDate: existingLastSyncedDate,
	};
}

async function handleDuplicateNotes(
	saveLocation: string,
	incomingNote: NormalizedNote,
	app: App
): Promise<"skip" | "rename" | "overwrite"> {
	const noteFilePath = `${saveLocation}/${incomingNote.title}.md`;
	const fileExists = await app.vault.adapter.exists(noteFilePath);

	if (fileExists) {
		const updatedFileInfo: UpdatedFileInfo =
			getUpdatedFileInfo(incomingNote);
		const existingFileInfo: ExistingFileInfo = await getExistingFileInfo(
			noteFilePath,
			app
		);

		return checkForDuplicateData(updatedFileInfo, existingFileInfo);
	} else {
		return "overwrite";
	}
}

function checkForDuplicateData(
	incomingFile: UpdatedFileInfo,
	existingFile: ExistingFileInfo
): "skip" | "rename" | "overwrite" {
	const currentDate = new Date();

	// Normalize dates for incoming file
	const incomingUpdatedDate = incomingFile.updatedDate || currentDate;

	// Normalize dates for existing file
	const existingUpdatedDate =
		existingFile.fsUpdatedDate ||
		existingFile.updatedDate ||
		existingFile.fsCreatedDate;
	const lastSyncedDate =
		existingFile.lastSyncedDate || existingFile.fsCreatedDate;

	// Step 1: Check if the contents are exactly the same
	if (incomingFile.content === existingFile.content) {
		return "skip";
	}

	// Step 2: If lastSyncedDate exists, use it to determine if both files have been modified
	if (lastSyncedDate && existingUpdatedDate) {
		const incomingModified = incomingUpdatedDate > lastSyncedDate;
		const existingModified = existingUpdatedDate > lastSyncedDate;

		if (incomingModified && existingModified) {
			return "rename"; // Both sides have been edited since last sync, so we rename
		}

		if (incomingModified && !existingModified) {
			return "overwrite"; // Only incoming file has been modified since last sync
		}

		if (!incomingModified && existingModified) {
			return "rename"; // Only existing file has been modified since last sync
		}

		// If neither file has been modified since last sync (shouldn't happen if contents differ, but just in case)
		return "skip";
	}

	// Step 3: If lastSyncedDate doesn't exist or couldn't be normalized, fall back to comparing dates
	if (existingUpdatedDate) {
		if (incomingUpdatedDate > existingUpdatedDate) {
			return "overwrite";
		} else if (incomingUpdatedDate < existingUpdatedDate) {
			return "rename";
		} else {
			// If dates are equal, we can't determine which is newer, so we rename to be safe
			return "rename";
		}
	} else {
		return "rename";
	}
}

export {
	normalizeDate,
	handleDuplicateNotes,
	checkForDuplicateData,
	getExistingFileInfo,
	getUpdatedFileInfo,
};
