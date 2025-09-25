import type { LastSyncSummary, SyncMode } from "../types/keepsidian-plugin-settings";

function formatCount(summary: LastSyncSummary, includeNotesWord = true): string {
        const { processedNotes, totalNotes } = summary;
        const base =
                typeof totalNotes === "number" && totalNotes > 0
                        ? `${processedNotes}/${totalNotes}`
                        : `${processedNotes}`;
        if (!includeNotesWord) {
                return base;
        }
        const noteLabel = processedNotes === 1 && totalNotes !== 1 ? "note" : "notes";
        return `${base} ${noteLabel}`;
}

function describeMode(mode: SyncMode): string {
        switch (mode) {
                case "two-way":
                        return "two-way sync";
                case "push":
                        return "upload";
                case "import":
                default:
                        return "import";
        }
}

function formatTimestamp(timestamp: number): string {
        const date = new Date(timestamp);
        if (Number.isNaN(date.getTime())) {
                return "unknown time";
        }
        try {
                return date.toLocaleString();
        } catch {
                return date.toISOString();
        }
}

export function formatStatusBarText(summary: LastSyncSummary | null): string {
        if (!summary) {
                return "Last sync: never";
        }
        if (!summary.success) {
                return "Last sync failed";
        }
        return typeof summary.totalNotes === "number" && summary.totalNotes > 0
                ? `Last synced: ${formatCount(summary, false)}`
                : `Last synced: ${formatCount(summary)}`;
}

export function formatStatusBarTooltip(summary: LastSyncSummary | null): string {
        if (!summary) {
                return "KeepSidian has not synced yet.";
        }
        const formattedTime = formatTimestamp(summary.timestamp);
        if (!summary.success) {
                const count = formatCount(summary);
                return `KeepSidian last sync failed: ${formattedTime} (processed ${count}).`;
        }
        const count = formatCount(summary);
        return `KeepSidian last synced: ${formattedTime} (${count}).`;
}

export function formatModalSummary(summary: LastSyncSummary | null): string {
        if (!summary) {
                return "No sync has been run yet.";
        }
        const formattedTime = formatTimestamp(summary.timestamp);
        const modeText = describeMode(summary.mode);
        const count = formatCount(summary);
        if (summary.success) {
                return `Last ${modeText} completed on ${formattedTime}: Synced ${count}.`;
        }
        return `Last ${modeText} attempt on ${formattedTime} failed after ${count}.`;
}
