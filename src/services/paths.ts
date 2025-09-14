import { MEDIA_FOLDER_NAME } from '../features/keep/constants';

export interface VaultAdapterLike {
  exists: (path: string) => Promise<boolean> | boolean;
}

export interface VaultLike {
  adapter: VaultAdapterLike & {
    // createFolder is on vault, not adapter; keep adapter minimal here
  };
  createFolder: (path: string) => Promise<void> | void;
}

export interface AppLike {
  vault: VaultLike;
}

export function normalizePathSafe(p: string): string {
  if (!p) return '';
  return p.replace(/\\/g, '/').replace(/\/+/g, '/');
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

export async function ensureFolder(app: AppLike, folderPath: string): Promise<void> {
  const path = normalizePathSafe(folderPath);
  if (!(await app.vault.adapter.exists(path))) {
    await app.vault.createFolder(path);
  }
}
