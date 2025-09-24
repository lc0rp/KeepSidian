import { FRONTMATTER_KEEP_SIDIAN_LAST_SYNCED_DATE_KEY } from "./constants";

function hasValue(value?: string | null): value is string {
        return typeof value === "string" && value.trim().length > 0;
}

export function buildFrontmatterWithSyncDate(
        newFrontmatter: string,
        lastSyncedDate: string,
        existingFrontmatter?: string
): string {
        if (hasValue(existingFrontmatter)) {
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

        if (hasValue(newFrontmatter)) {
                if (
                        newFrontmatter.includes(
                                `${FRONTMATTER_KEEP_SIDIAN_LAST_SYNCED_DATE_KEY}:`
                        )
                ) {
                        const re = new RegExp(
                                `${FRONTMATTER_KEEP_SIDIAN_LAST_SYNCED_DATE_KEY}:\\s*[^\\n]*`
                        );
                        return newFrontmatter.replace(
                                re,
                                `${FRONTMATTER_KEEP_SIDIAN_LAST_SYNCED_DATE_KEY}: ${lastSyncedDate}`
                        );
                }
                return `${newFrontmatter}\n${FRONTMATTER_KEEP_SIDIAN_LAST_SYNCED_DATE_KEY}: ${lastSyncedDate}`;
        }

        return `${FRONTMATTER_KEEP_SIDIAN_LAST_SYNCED_DATE_KEY}: ${lastSyncedDate}`;
}

export function wrapMarkdown(frontmatter: string, text: string): string {
        return `---\n${frontmatter}\n---\n${text}`;
}

