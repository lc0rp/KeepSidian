import { MEDIA_FOLDER_NAME } from "../features/keep/constants";

export interface VaultAdapterLike {
	exists: (path: string) => Promise<boolean> | boolean;
	read: (path: string) => Promise<string> | string;
	write: (path: string, data: string) => Promise<void> | void;
}

export interface VaultLike {
	adapter: VaultAdapterLike & {
		// createFolder is on vault, not adapter; keep adapter minimal here
	};
	// Obsidian returns Promise<TFolder>; allow any promise type without coupling
	createFolder: (path: string) => Promise<unknown> | void;
}

export interface AppLike {
	vault: VaultLike;
}

export function normalizePathSafe(p: string): string {
	if (!p) return "";
	return p.replace(/\\/g, "/").replace(/\/+/g, "/");
}

export function dirnameSafe(p: string): string {
	const path = normalizePathSafe(p);
	const idx = path.lastIndexOf("/");
	if (idx <= 0) return "";
	return path.slice(0, idx);
}

export function buildNotePath(saveLocation: string, noteTitle: string): string {
	return normalizePathSafe(`${saveLocation}/${noteTitle}.md`);
}

export function mediaFolderPath(saveLocation: string): string {
	return normalizePathSafe(`${saveLocation}/${MEDIA_FOLDER_NAME}`);
}

export function buildMediaPath(saveLocation: string, fileName: string): string {
	const folder = mediaFolderPath(saveLocation);
	return normalizePathSafe(`${folder}/${fileName}`);
}

export async function ensureFolder(
	app: AppLike,
	folderPath: string
): Promise<void> {
	const path = normalizePathSafe(folderPath);
	if (!(await app.vault.adapter.exists(path))) {
		await app.vault.createFolder(path);
	}
}

export async function ensureParentFolderForFile(
	app: AppLike,
	filePath: string
): Promise<void> {
	const parent = dirnameSafe(filePath);
	if (parent) {
		await ensureFolder(app, parent);
	}
}

export async function ensureFile(
	app: AppLike,
	filePath: string
): Promise<void> {
	const normalized = normalizePathSafe(filePath);
	await ensureParentFolderForFile(app, normalized);
	const exists = await app.vault.adapter.exists(normalized);
	if (!exists) {
		await app.vault.adapter.write(normalized, "");
	}
}
