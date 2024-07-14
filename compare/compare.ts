import { NormalizedNote, normalizeDate, extractFrontmatter } from "../note/note";

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

async function getExistingFileInfo(noteFilePath: string, app: any): Promise<ExistingFileInfo> {
    const existingContent = await app.vault.adapter.read(noteFilePath);
    const [existingFrontMatter, existingBody, existingFrontMatterDict] = extractFrontmatter(existingContent);

    // Get rid of any frontMatter from existingContent
    const existingCreatedDate = normalizeDate(existingFrontMatterDict.Created);
    console.log(existingCreatedDate);
    const existingUpdatedDate = normalizeDate(existingFrontMatterDict.Updated);
    console.log(existingUpdatedDate);
    const existingLastSyncedDate = normalizeDate(existingFrontMatterDict.LastSynced);
    console.log(existingLastSyncedDate);

    // Get fsCreatedDate and fsUpdatedDate from noteFilePath
    const fsCreatedDateTimeStamp = await app.vault.adapter.stat(noteFilePath).then((stat: { ctime?: number }) => stat?.ctime);
    console.log(fsCreatedDateTimeStamp);
    const fsUpdatedDateTimeStamp = await app.vault.adapter.stat(noteFilePath).then((stat: { mtime?: number }) => stat?.mtime);
    console.log(fsUpdatedDateTimeStamp);
    const fsCreatedDate = fsCreatedDateTimeStamp ? new Date(fsCreatedDateTimeStamp) : null;
    console.log(fsCreatedDate);
    const fsUpdatedDate = fsUpdatedDateTimeStamp ? new Date(fsUpdatedDateTimeStamp) : null;
    console.log(fsUpdatedDate);
    
    return {
        // Read from noteFilePath
        content: existingBody,
        createdDate: existingCreatedDate,
        updatedDate: existingUpdatedDate,
        fsCreatedDate: fsCreatedDate,
        fsUpdatedDate: fsUpdatedDate,
        lastSyncedDate: existingLastSyncedDate
    };
}

async function handleDuplicateNotes(
    saveLocation: string,
    incomingNote: NormalizedNote,
    app: any
): Promise<'skip' | 'rename' | 'overwrite'> {
    let noteFilePath = `${saveLocation}/${incomingNote.title}.md`;
    const fileExists = await app.vault.adapter.exists(noteFilePath);

    if (fileExists) {
        const updatedFileInfo: UpdatedFileInfo = getUpdatedFileInfo(incomingNote);
        const existingFileInfo: ExistingFileInfo = await getExistingFileInfo(noteFilePath, app);

        return checkForDuplicateData(updatedFileInfo, existingFileInfo);
    } else {
        return 'overwrite';
    }
}

function checkForDuplicateData(
    incomingFile: UpdatedFileInfo,
    existingFile: ExistingFileInfo
): 'skip' | 'rename' | 'overwrite' {
    const currentDate = new Date();

    // Normalize dates for incoming file
    const incomingCreatedDate = incomingFile.createdDate || currentDate;
    const incomingUpdatedDate = incomingFile.updatedDate || currentDate;

    // Normalize dates for existing file
    const existingCreatedDate = existingFile.createdDate || existingFile.fsCreatedDate;
    const existingUpdatedDate = existingFile.fsUpdatedDate || existingFile.updatedDate || existingFile.fsCreatedDate;
    const lastSyncedDate = existingFile.lastSyncedDate || existingFile.fsCreatedDate;

    // Step 1: Check if the contents are exactly the same
    if (incomingFile.content === existingFile.content) {
        return 'skip';
    }

    // Step 2: If lastSyncedDate exists, use it to determine if both files have been modified
    if (lastSyncedDate && existingUpdatedDate) {
        const incomingModified = incomingUpdatedDate > lastSyncedDate;
        const existingModified = existingUpdatedDate > lastSyncedDate;

        if (incomingModified && existingModified) {
            return 'rename';  // Both sides have been edited since last sync, so we rename
        }

        if (incomingModified && !existingModified) {
            return 'overwrite';  // Only incoming file has been modified since last sync
        }

        if (!incomingModified && existingModified) {
            return 'rename';  // Only existing file has been modified since last sync
        }

        // If neither file has been modified since last sync (shouldn't happen if contents differ, but just in case)
        return 'skip';
    }

    // Step 3: If lastSyncedDate doesn't exist or couldn't be normalized, fall back to comparing dates
    if (existingUpdatedDate) {
        if (incomingUpdatedDate > existingUpdatedDate) {
            return 'overwrite';
        } else if (incomingUpdatedDate < existingUpdatedDate) {
            return 'rename';
        } else {
            // If dates are equal, we can't determine which is newer, so we rename to be safe
            return 'rename';
        }
    } else {
        return 'rename';
    }
}

export {normalizeDate, handleDuplicateNotes, checkForDuplicateData, getExistingFileInfo, getUpdatedFileInfo };