export type DownloadScopeKind = "last-sync" | "all" | "custom-since";

export interface DownloadScope {
	kind: DownloadScopeKind;
	since?: string;
}
