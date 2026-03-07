import type { KeepSidianPluginSettings } from "../types/keepsidian-plugin-settings";
import type KeepSidianPlugin from "./main";

interface SecretStorageAdapter {
	setSecret: (id: string, secret: string) => void;
	getSecret: (id: string) => string | null;
}

export const SYNC_TOKEN_SECRET_ID = "google-sync-token";
export const GDRIVE_TOKEN_SECRET_ID = "google-drive-access-token";
export const GDRIVE_REFRESH_TOKEN_SECRET_ID = "google-drive-refresh-token";

function getSecretStorage(plugin: KeepSidianPlugin): SecretStorageAdapter | null {
	const candidate = (plugin.app as unknown as { secretStorage?: unknown }).secretStorage;
	if (!candidate || typeof candidate !== "object") {
		return null;
	}
	const storage = candidate as Partial<SecretStorageAdapter>;
	if (typeof storage.setSecret !== "function" || typeof storage.getSecret !== "function") {
		return null;
	}
	return storage as SecretStorageAdapter;
}

function getSecret(plugin: KeepSidianPlugin, secretId: string): string | null {
	const storage = getSecretStorage(plugin);
	if (!storage) {
		return null;
	}
	try {
		return storage.getSecret(secretId);
	} catch {
		return null;
	}
}

function setSecret(plugin: KeepSidianPlugin, secretId: string, value: string): boolean {
	const storage = getSecretStorage(plugin);
	if (!storage) {
		return false;
	}
	try {
		storage.setSecret(secretId, value);
		return true;
	} catch {
		return false;
	}
}

export function hydrateSyncTokenFromSecretStorage(plugin: KeepSidianPlugin): boolean {
	const secretStorage = getSecretStorage(plugin);
	if (!secretStorage) {
		return false;
	}

	let changed = false;
	plugin.settings.syncTokenSecretId = plugin.settings.syncTokenSecretId || SYNC_TOKEN_SECRET_ID;
	const trimmedToken = plugin.settings.token?.trim() ?? "";

	if (trimmedToken.length > 0) {
		if (setSecret(plugin, plugin.settings.syncTokenSecretId, trimmedToken)) {
			plugin.settings.token = trimmedToken;
			changed = true;
		}
	} else {
		const secretToken = getSecret(plugin, plugin.settings.syncTokenSecretId);
		if (typeof secretToken === "string" && secretToken.trim().length > 0) {
			plugin.settings.token = secretToken;
			changed = true;
		}
	}

	return changed;
}

export function hydrateDriveSecretsFromSecretStorage(plugin: KeepSidianPlugin): boolean {
	const secretStorage = getSecretStorage(plugin);
	if (!secretStorage) {
		return false;
	}

	let changed = false;
	plugin.settings.gdriveTokenSecretId =
		plugin.settings.gdriveTokenSecretId || GDRIVE_TOKEN_SECRET_ID;
	plugin.settings.gdriveRefreshTokenSecretId =
		plugin.settings.gdriveRefreshTokenSecretId || GDRIVE_REFRESH_TOKEN_SECRET_ID;

	const trimmedDriveToken = plugin.settings.gdriveToken?.trim() ?? "";
	if (trimmedDriveToken.length > 0) {
		if (setSecret(plugin, plugin.settings.gdriveTokenSecretId, trimmedDriveToken)) {
			plugin.settings.gdriveToken = trimmedDriveToken;
			changed = true;
		}
	} else {
		const driveToken = getSecret(plugin, plugin.settings.gdriveTokenSecretId);
		if (typeof driveToken === "string" && driveToken.trim().length > 0) {
			plugin.settings.gdriveToken = driveToken;
			changed = true;
		}
	}

	const trimmedRefreshToken = plugin.settings.gdriveRefreshToken?.trim() ?? "";
	if (trimmedRefreshToken.length > 0) {
		if (setSecret(plugin, plugin.settings.gdriveRefreshTokenSecretId, trimmedRefreshToken)) {
			plugin.settings.gdriveRefreshToken = trimmedRefreshToken;
			changed = true;
		}
	} else {
		const refreshToken = getSecret(plugin, plugin.settings.gdriveRefreshTokenSecretId);
		if (typeof refreshToken === "string" && refreshToken.trim().length > 0) {
			plugin.settings.gdriveRefreshToken = refreshToken;
			changed = true;
		}
	}

	return changed;
}

export function persistSensitiveSettingsToSecretStorage(plugin: KeepSidianPlugin): void {
	if (!getSecretStorage(plugin)) {
		return;
	}

	plugin.settings.syncTokenSecretId = plugin.settings.syncTokenSecretId || SYNC_TOKEN_SECRET_ID;
	plugin.settings.gdriveTokenSecretId =
		plugin.settings.gdriveTokenSecretId || GDRIVE_TOKEN_SECRET_ID;
	plugin.settings.gdriveRefreshTokenSecretId =
		plugin.settings.gdriveRefreshTokenSecretId || GDRIVE_REFRESH_TOKEN_SECRET_ID;

	void setSecret(plugin, plugin.settings.syncTokenSecretId, plugin.settings.token?.trim() ?? "");
	void setSecret(
		plugin,
		plugin.settings.gdriveTokenSecretId,
		plugin.settings.gdriveToken?.trim() ?? ""
	);
	void setSecret(
		plugin,
		plugin.settings.gdriveRefreshTokenSecretId,
		plugin.settings.gdriveRefreshToken?.trim() ?? ""
	);
}

export function buildPersistedSettings(plugin: KeepSidianPlugin): KeepSidianPluginSettings {
	if (!getSecretStorage(plugin)) {
		return plugin.settings;
	}
	return {
		...plugin.settings,
		token: "",
		gdriveToken: undefined,
		gdriveRefreshToken: undefined,
	};
}
