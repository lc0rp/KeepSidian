import {
	DEFAULT_PREMIUM_FEATURES,
	PremiumFeatureSettings,
	SubscriptionCache,
} from "./subscription";

export type SyncMode = "import" | "push" | "two-way";

export interface LastSyncSummary {
	timestamp: number;
	processedNotes: number;
	totalNotes?: number | null;
	success: boolean;
	mode: SyncMode;
}

export interface KeepSidianPluginSettings {
	email: string;
	token: string;
	saveLocation: string;
	oauthFlow: "desktop" | "webviewer";
	oauthDebugMode: boolean;
	oauthPlaywrightUseSystemBrowser: boolean;
	subscriptionCache?: SubscriptionCache;
	premiumFeatures: PremiumFeatureSettings;
	gdriveToken?: string;
	gdriveRefreshToken?: string;
	gdriveSaveLocation?: string;
	autoSyncEnabled: boolean;
	autoSyncIntervalHours: number;
	lastSyncSummary: LastSyncSummary | null;
	lastSyncLogPath?: string | null;
	keepSidianLastSuccessfulSyncDate?: string | null;
	frontmatterPascalCaseFixApplied?: boolean;
	twoWaySyncBackupAcknowledged: boolean;
	twoWaySyncEnabled: boolean;
	twoWaySyncAutoSyncEnabled: boolean;
}

export const DEFAULT_SETTINGS: KeepSidianPluginSettings = {
	email: "",
	token: "",
	saveLocation: "Google Keep",
	oauthFlow: "desktop",
	oauthDebugMode: false,
	oauthPlaywrightUseSystemBrowser: false,
	subscriptionCache: undefined,
	premiumFeatures: DEFAULT_PREMIUM_FEATURES,
	gdriveToken: undefined,
	gdriveRefreshToken: undefined,
	gdriveSaveLocation: undefined,
	autoSyncEnabled: false,
	autoSyncIntervalHours: 24,
	lastSyncSummary: null,
	lastSyncLogPath: null,
	keepSidianLastSuccessfulSyncDate: null,
	frontmatterPascalCaseFixApplied: false,
	twoWaySyncBackupAcknowledged: false,
	twoWaySyncEnabled: false,
	twoWaySyncAutoSyncEnabled: false,
};
