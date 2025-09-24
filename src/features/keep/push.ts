import { Notice } from "obsidian";
import type KeepSidianPlugin from "@app/main";
import { extractFrontmatter } from "./domain/note";
import {
        dirnameSafe,
        ensureFolder,
        normalizePathSafe,
        mediaFolderPath,
} from "@services/paths";
import { logSync } from "@app/logging";
import { buildFrontmatterWithSyncDate, wrapMarkdown } from "./frontmatter";
import {
        CONFLICT_FILE_SUFFIX,
        FRONTMATTER_KEEP_SIDIAN_LAST_SYNCED_DATE_KEY,
} from "./constants";
import type { SyncCallbacks } from "./sync";
import {
        pushNotes as apiPushNotes,
        PushAttachmentPayload,
        PushNotePayload,
        PushNoteResult,
} from "@integrations/server/keepApi";

interface VaultAdapter {
        list?: (path: string) => Promise<{ files: string[]; folders: string[] }>;
        read: (path: string) => Promise<string>;
        write: (path: string, data: string) => Promise<void>;
        readBinary?: (path: string) => Promise<ArrayBuffer>;
        stat?: (path: string) => Promise<{ mtime?: number } | null>;
        exists?: (path: string) => Promise<boolean>;
}

interface AttachmentCollectionResult {
        payloads: PushAttachmentPayload[];
        updatedAttachments: string[];
        missingAttachments: string[];
}

interface NoteForPush {
        fullPath: string;
        relativePath: string;
        title: string;
        content: string;
        body: string;
        frontmatter: string;
        lastSyncedDate: Date | null;
        modifiedSinceLastSync: boolean;
        attachments: PushAttachmentPayload[];
        updatedAttachmentNames: string[];
        missingAttachments: string[];
}

interface CollectedNotesResult {
        notesToPush: NoteForPush[];
        skippedNotes: Array<{ path: string; reason: string }>;
}

function parseDate(value?: string): Date | null {
        if (!value) {
                return null;
        }
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function listMarkdownFilesRecursively(
        adapter: VaultAdapter,
        folder: string
): Promise<string[]> {
        const normalizedFolder = normalizePathSafe(folder);
        if (typeof adapter.list !== "function") {
                return [];
        }

        try {
                const { files, folders } = await adapter.list(normalizedFolder);
                const markdownFiles = files
                        .map((file) => normalizePathSafe(file))
                        .filter((file) => file.toLowerCase().endsWith(".md"));

                for (const subfolder of folders) {
                        const normalizedSubfolder = normalizePathSafe(subfolder);
                        const name = normalizedSubfolder.split("/").pop();
                        if (!name) {
                                continue;
                        }
                        if (name === "media" || name === "_KeepSidianLogs") {
                                continue;
                        }
                        const nested = await listMarkdownFilesRecursively(
                                adapter,
                                normalizedSubfolder
                        );
                        markdownFiles.push(...nested);
                }

                return markdownFiles;
        } catch (error: unknown) {
                console.error("Failed to list files for push", error);
                return [];
        }
}

function normalizeRelativePath(notePath: string, baseFolder: string): string {
        const normalizedBase = normalizePathSafe(baseFolder);
        const normalizedNote = normalizePathSafe(notePath);
        if (normalizedNote.startsWith(`${normalizedBase}/`)) {
                return normalizedNote.slice(normalizedBase.length + 1);
        }
        return normalizedNote;
}

function resolveRelativePath(baseDir: string, target: string): string {
        const baseSegments = normalizePathSafe(baseDir)
                .split("/")
                .filter(Boolean);
        const targetSegments = normalizePathSafe(target)
                .split("/")
                .filter(Boolean);
        const stack = [...baseSegments];
        for (const segment of targetSegments) {
                if (!segment || segment === ".") {
                        continue;
                }
                if (segment === "..") {
                        stack.pop();
                } else {
                        stack.push(segment);
                }
        }
        return stack.join("/");
}

function extractAttachmentReferences(
        noteContent: string,
        notePath: string,
        saveLocation: string
): string[] {
        const references = new Set<string>();
        const mediaFolder = mediaFolderPath(saveLocation);
        const mediaFolderNormalized = normalizePathSafe(mediaFolder);
        const mediaRelative = normalizeRelativePath(mediaFolderNormalized, saveLocation);
        const noteDir = dirnameSafe(notePath);

        const wikiLinkRegex = /!\[\[([^\]]+)\]\]/g;
        const markdownImageRegex = /!\[[^\]]*\]\(([^)]+)\)/g;

        const processMatch = (rawTarget: string) => {
                if (!rawTarget) {
                        return;
                }
                let target = rawTarget.split("|")[0];
                target = target.split("#")[0];
                target = target.replace(/^</, "").replace(/>$/, "");
                target = target.trim();
                if (!target || target.includes("://")) {
                        return;
                }
                const normalizedTarget = normalizePathSafe(target).replace(/^\.\//, "");

                const candidates = new Set<string>();

                if (normalizedTarget.startsWith(mediaFolderNormalized)) {
                        candidates.add(normalizedTarget);
                }

                if (normalizedTarget.startsWith(mediaRelative)) {
                        candidates.add(
                                normalizePathSafe(
                                        `${saveLocation}/${normalizedTarget}`
                                )
                        );
                }

                if (!normalizedTarget.includes("/")) {
                        candidates.add(
                                normalizePathSafe(
                                        `${mediaFolderNormalized}/${normalizedTarget}`
                                )
                        );
                }

                if (!normalizedTarget.startsWith(mediaFolderNormalized)) {
                        const resolved = resolveRelativePath(noteDir, normalizedTarget);
                        candidates.add(resolved);
                }

                for (const candidate of candidates) {
                        const normalizedCandidate = normalizePathSafe(candidate);
                        if (normalizedCandidate.startsWith(mediaFolderNormalized)) {
                                references.add(normalizedCandidate);
                        }
                }
        };

        let wikiMatch: RegExpExecArray | null;
        while ((wikiMatch = wikiLinkRegex.exec(noteContent)) !== null) {
                processMatch(wikiMatch[1]);
        }

        let mdMatch: RegExpExecArray | null;
        while ((mdMatch = markdownImageRegex.exec(noteContent)) !== null) {
                processMatch(mdMatch[1]);
        }

        return Array.from(references);
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
        const globalBuffer = (globalThis as unknown as { Buffer?: any }).Buffer;
        if (globalBuffer?.from) {
                return globalBuffer.from(buffer).toString("base64");
        }
        const bytes = new Uint8Array(buffer);
        let binary = "";
        for (let i = 0; i < bytes.byteLength; i += 1) {
                binary += String.fromCharCode(bytes[i]);
        }
        if (typeof btoa === "function") {
                return btoa(binary);
        }
        throw new Error("Unable to encode attachment to base64");
}

function guessMimeType(fileName: string): string {
        const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
        const mapping: Record<string, string> = {
                png: "image/png",
                jpg: "image/jpeg",
                jpeg: "image/jpeg",
                gif: "image/gif",
                webp: "image/webp",
                svg: "image/svg+xml",
                bmp: "image/bmp",
                heic: "image/heic",
                mp3: "audio/mpeg",
                wav: "audio/wav",
                m4a: "audio/m4a",
                ogg: "audio/ogg",
                mp4: "video/mp4",
                mov: "video/quicktime",
                avi: "video/x-msvideo",
                pdf: "application/pdf",
                txt: "text/plain",
                md: "text/markdown",
                csv: "text/csv",
                tsv: "text/tab-separated-values",
                json: "application/json",
                html: "text/html",
        };
        return mapping[extension] || "application/octet-stream";
}

async function collectAttachments(
        adapter: VaultAdapter,
        noteContent: string,
        notePath: string,
        saveLocation: string,
        lastSynced: Date | null
): Promise<AttachmentCollectionResult> {
        const attachmentPaths = extractAttachmentReferences(
                noteContent,
                notePath,
                saveLocation
        );
        const payloads: PushAttachmentPayload[] = [];
        const updatedAttachments: string[] = [];
        const missingAttachments: string[] = [];

        for (const attachmentPath of attachmentPaths) {
                try {
                        if (typeof adapter.exists === "function") {
                                const exists = await adapter.exists(attachmentPath);
                                if (!exists) {
                                        missingAttachments.push(attachmentPath);
                                        continue;
                                }
                        }

                        const stat =
                                typeof adapter.stat === "function"
                                        ? await adapter.stat(attachmentPath)
                                        : null;
                        const updated = stat?.mtime
                                ? new Date(stat.mtime)
                                : null;
                        const shouldInclude =
                                !lastSynced ||
                                !updated ||
                                (lastSynced && updated > lastSynced);
                        if (!shouldInclude) {
                                continue;
                        }

                        let data: ArrayBuffer;
                        if (typeof adapter.readBinary === "function") {
                                data = await adapter.readBinary(attachmentPath);
                        } else {
                                const text = await adapter.read(attachmentPath);
                                data = new TextEncoder().encode(text).buffer;
                        }
                        const name = attachmentPath.split("/").pop() ?? attachmentPath;
                        payloads.push({
                                name,
                                mime_type: guessMimeType(name),
                                data: arrayBufferToBase64(data),
                        });
                        updatedAttachments.push(name);
                } catch (error) {
                        console.error("Failed to collect attachment", error);
                        throw new Error(`Failed to read attachment ${attachmentPath}`);
                }
        }

        return { payloads, updatedAttachments, missingAttachments };
}

function deriveNoteTitle(relativePath: string): string {
        const parts = relativePath.split("/");
        const fileName = parts[parts.length - 1] || relativePath;
        return fileName.replace(/\.md$/i, "");
}

async function collectNotesToPush(
        plugin: KeepSidianPlugin
): Promise<CollectedNotesResult> {
        const adapter = plugin.app.vault.adapter as VaultAdapter;
        const saveLocation = plugin.settings.saveLocation;
        await ensureFolder(plugin.app, saveLocation);

        const markdownFiles = await listMarkdownFilesRecursively(
                adapter,
                saveLocation
        );

        const notesToPush: NoteForPush[] = [];
        const skippedNotes: Array<{ path: string; reason: string }> = [];

        for (const filePath of markdownFiles) {
                try {
                        if (filePath.includes(CONFLICT_FILE_SUFFIX)) {
                                skippedNotes.push({
                                        path: filePath,
                                        reason: "conflict copy (skipped)",
                                });
                                continue;
                        }

                        const content = await adapter.read(filePath);
                        const [frontmatter, body, frontmatterDict] =
                                extractFrontmatter(content);
                        const lastSyncedValue =
                                frontmatterDict[FRONTMATTER_KEEP_SIDIAN_LAST_SYNCED_DATE_KEY];
                        const lastSyncedDate = parseDate(lastSyncedValue);
                        const stat =
                                typeof adapter.stat === "function"
                                        ? await adapter.stat(filePath)
                                        : null;
                        const modifiedDate = stat?.mtime
                                ? new Date(stat.mtime)
                                : null;
                        const modifiedSinceLastSync =
                                !lastSyncedDate ||
                                (modifiedDate && lastSyncedDate && modifiedDate > lastSyncedDate);

                        const { payloads, updatedAttachments, missingAttachments } =
                                await collectAttachments(
                                        adapter,
                                        content,
                                        filePath,
                                        saveLocation,
                                        lastSyncedDate
                                );

                        const shouldPush =
                                modifiedSinceLastSync || payloads.length > 0 || !lastSyncedDate;

                        const relativePath = normalizeRelativePath(filePath, saveLocation);
                        const title = frontmatterDict.Title
                                ? frontmatterDict.Title
                                : deriveNoteTitle(relativePath);

                        if (!shouldPush) {
                                skippedNotes.push({
                                        path: filePath,
                                        reason: "up-to-date",
                                });
                                continue;
                        }

                        notesToPush.push({
                                fullPath: filePath,
                                relativePath,
                                title,
                                content,
                                body,
                                frontmatter,
                                lastSyncedDate,
                                modifiedSinceLastSync,
                                attachments: payloads,
                                updatedAttachmentNames: updatedAttachments,
                                missingAttachments,
                        });
                } catch (error: unknown) {
                        console.error("Failed to prepare note for push", error);
                        skippedNotes.push({
                                path: filePath,
                                reason: `error: ${(error as Error).message}`,
                        });
                }
        }

        return { notesToPush, skippedNotes };
}

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

                for (const skipped of skippedNotes) {
                        const fileName = skipped.path.split("/").pop() || skipped.path;
                        const link = `[${fileName}](${normalizePathSafe(skipped.path)})`;
                        const message =
                                skipped.reason === "up-to-date"
                                        ? "up to date (skipped)"
                                        : skipped.reason;
                        await logSync(plugin, `${link} - ${message}`);
                }

                if (notesToPush.length === 0) {
                        new Notice("No Google Keep notes to push.");
                        return 0;
                }

                callbacks?.setTotalNotes?.(notesToPush.length);

                const payload: PushNotePayload[] = notesToPush.map((note) => ({
                        path: note.relativePath,
                        title: note.title,
                        content: note.content,
                        attachments:
                                note.attachments.length > 0 ? note.attachments : undefined,
                }));

                const { email, token } = plugin.settings;
                const response = await apiPushNotes(email, token, payload);
                const resultMap = mapResultsByPath(response?.results);

                const pushTimestamp = new Date().toISOString();
                let successCount = 0;

                for (const note of notesToPush) {
                        try {
                                const normalizedPath = normalizePathSafe(note.relativePath);
                                const result =
                                        resultMap.get(normalizedPath) ??
                                        resultMap.get(note.relativePath);
                                if (result && result.success === false) {
                                        const errorText = result.error || result.message || "failed";
                                        await logSync(
                                                plugin,
                                                `[${note.title}](${normalizePathSafe(
                                                        note.fullPath
                                                )}) - push failed: ${errorText}`
                                        );
                                        continue;
                                }

                                const frontmatterWithSync = buildFrontmatterWithSyncDate(
                                        note.frontmatter,
                                        pushTimestamp
                                );
                                const updatedContent = wrapMarkdown(
                                        frontmatterWithSync,
                                        note.body
                                );
                                await (plugin.app.vault.adapter as VaultAdapter).write(
                                        note.fullPath,
                                        updatedContent
                                );

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
                                        `[${note.title}](${normalizePathSafe(
                                                note.fullPath
                                        )}) - pushed${attachmentSuffix}`
                                );
                                for (const missing of note.missingAttachments) {
                                        await logSync(
                                                plugin,
                                                `[${note.title}](${normalizePathSafe(
                                                        note.fullPath
                                                )}) - missing attachment ${missing}`
                                        );
                                }
                                successCount += 1;
                        } catch (error: unknown) {
                                await logSync(
                                        plugin,
                                        `[${note.title}](${normalizePathSafe(
                                                note.fullPath
                                        )}) - error: ${(error as Error).message}`
                                );
                        } finally {
                                callbacks?.reportProgress?.();
                        }
                }

                new Notice("Pushed Google Keep notes.");
                return successCount;
        } catch (error: unknown) {
                new Notice("Failed to push notes.");
                throw error;
        }
}

