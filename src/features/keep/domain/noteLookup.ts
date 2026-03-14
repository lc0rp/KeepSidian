import { normalizePathSafe } from "@services/paths";
import { extractFrontmatter, getFrontmatterStringValue, type NormalizedNote } from "./note";
import {
	FRONTMATTER_GOOGLE_KEEP_CREATED_DATE_KEY,
	FRONTMATTER_GOOGLE_KEEP_UPDATED_DATE_KEY,
	FRONTMATTER_GOOGLE_KEEP_URL_KEY,
	FRONTMATTER_KEEP_SIDIAN_LAST_SYNCED_DATE_KEY,
} from "../constants";

type ListableAdapter = {
	list?: (path: string) => Promise<{ files: string[]; folders: string[] }>;
	exists?: (path: string) => Promise<boolean>;
	read: (path: string) => Promise<string>;
};

export async function listMarkdownFilesRecursively(
	adapter: ListableAdapter,
	folder = ""
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
			const nested = await listMarkdownFilesRecursively(adapter, subfolder);
			markdownFiles.push(...nested);
		}

		return markdownFiles;
	} catch {
		return [];
	}
}

export function isKeepSidianFrontmatter(frontmatterDict: Record<string, unknown>): boolean {
	return (
		typeof getFrontmatterStringValue(frontmatterDict, FRONTMATTER_GOOGLE_KEEP_URL_KEY) ===
			"string" ||
		typeof getFrontmatterStringValue(frontmatterDict, FRONTMATTER_KEEP_SIDIAN_LAST_SYNCED_DATE_KEY) ===
			"string" ||
		typeof getFrontmatterStringValue(frontmatterDict, FRONTMATTER_GOOGLE_KEEP_CREATED_DATE_KEY) ===
			"string" ||
		typeof getFrontmatterStringValue(frontmatterDict, FRONTMATTER_GOOGLE_KEEP_UPDATED_DATE_KEY) ===
			"string"
	);
}

export async function findExistingKeepNotePath(
	app: { vault: { adapter: ListableAdapter } },
	incomingNote: NormalizedNote,
	preferredPath?: string
): Promise<string | null> {
	const adapter = app.vault.adapter;
	const normalizedPreferredPath = preferredPath ? normalizePathSafe(preferredPath) : null;

	if (
		normalizedPreferredPath &&
		typeof adapter.exists === "function" &&
		(await adapter.exists(normalizedPreferredPath))
	) {
		return normalizedPreferredPath;
	}

	const incomingKeepUrl = getFrontmatterStringValue(
		incomingNote.frontmatterDict,
		FRONTMATTER_GOOGLE_KEEP_URL_KEY
	);
	if (!incomingKeepUrl) {
		return normalizedPreferredPath;
	}

	const markdownFiles = await listMarkdownFilesRecursively(adapter, "");
	for (const filePath of markdownFiles) {
		const normalizedPath = normalizePathSafe(filePath);
		if (normalizedPreferredPath && normalizedPath === normalizedPreferredPath) {
			continue;
		}

		try {
			const content = await adapter.read(normalizedPath);
			const [, , frontmatterDict] = extractFrontmatter(content);
			const existingKeepUrl = getFrontmatterStringValue(frontmatterDict, FRONTMATTER_GOOGLE_KEEP_URL_KEY);
			if (existingKeepUrl === incomingKeepUrl) {
				return normalizedPath;
			}
		} catch {
			// Ignore unreadable candidates during lookup.
		}
	}

	return normalizedPreferredPath;
}
