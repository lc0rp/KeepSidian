import {
	FRONTMATTER_GOOGLE_KEEP_ARCHIVED_KEY,
	FRONTMATTER_GOOGLE_KEEP_COLOR_KEY,
	FRONTMATTER_GOOGLE_KEEP_CREATED_DATE_KEY,
	FRONTMATTER_GOOGLE_KEEP_PINNED_KEY,
	FRONTMATTER_GOOGLE_KEEP_UPDATED_DATE_KEY,
	FRONTMATTER_GOOGLE_KEEP_URL_KEY,
	FRONTMATTER_KEEP_SIDIAN_LAST_SYNCED_DATE_KEY,
} from "./constants";

function hasValue(value?: string | null): value is string {
        return typeof value === "string" && value.trim().length > 0;
}

const KEEP_MANAGED_FRONTMATTER_KEYS = [
	FRONTMATTER_GOOGLE_KEEP_CREATED_DATE_KEY,
	FRONTMATTER_GOOGLE_KEEP_UPDATED_DATE_KEY,
	FRONTMATTER_GOOGLE_KEEP_URL_KEY,
	FRONTMATTER_GOOGLE_KEEP_COLOR_KEY,
	FRONTMATTER_GOOGLE_KEEP_PINNED_KEY,
	FRONTMATTER_GOOGLE_KEEP_ARCHIVED_KEY,
] as const;

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceOrAppendFrontmatterLine(
	frontmatter: string,
	key: string,
	value: string
): string {
	const line = `${key}: ${value}`;
	const trimmedFrontmatter = frontmatter.trim();
	const linePattern = new RegExp(`^${escapeRegExp(key)}:\\s*.*$`, "m");

	if (!trimmedFrontmatter) {
		return line;
	}

	if (linePattern.test(trimmedFrontmatter)) {
		return trimmedFrontmatter.replace(linePattern, line);
	}

	return `${trimmedFrontmatter}\n${line}`;
}

function mergeKeepManagedFrontmatter(
	baseFrontmatter: string,
	incomingFrontmatter?: string
): string {
	let merged = baseFrontmatter.trim();
	if (!hasValue(incomingFrontmatter)) {
		return merged;
	}

	for (const key of KEEP_MANAGED_FRONTMATTER_KEYS) {
		const match = incomingFrontmatter.match(
			new RegExp(`^${escapeRegExp(key)}:\\s*(.*)$`, "m")
		);
		if (!match) {
			continue;
		}
		merged = replaceOrAppendFrontmatterLine(merged, key, match[1].trim());
	}

	return merged;
}

export function buildFrontmatterWithSyncDate(
        newFrontmatter: string,
        lastSyncedDate: string,
        existingFrontmatter?: string
): string {
        const mergedFrontmatter = mergeKeepManagedFrontmatter(
                newFrontmatter,
                existingFrontmatter
        );

        return replaceOrAppendFrontmatterLine(
                mergedFrontmatter,
                FRONTMATTER_KEEP_SIDIAN_LAST_SYNCED_DATE_KEY,
                lastSyncedDate
        );
}

export function wrapMarkdown(frontmatter: string, text: string): string {
        return `---\n${frontmatter}\n---\n${text}`;
}
