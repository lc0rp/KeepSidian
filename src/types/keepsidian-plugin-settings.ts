import {
	DEFAULT_PREMIUM_FEATURES,
	PremiumFeatureSettings,
	SubscriptionCache,
} from "./subscription";

export interface KeepSidianPluginSettings {
	email: string;
	token: string;
	saveLocation: string;
	subscriptionCache?: SubscriptionCache;
	premiumFeatures: PremiumFeatureSettings;
	gdriveToken?: string;
	gdriveRefreshToken?: string;
	gdriveSaveLocation?: string;
	autoSyncEnabled: boolean;
	autoSyncIntervalHours: number;
}

export const DEFAULT_SETTINGS: KeepSidianPluginSettings = {
	email: "",
	token: "",
	saveLocation: "Google Keep",
	subscriptionCache: undefined,
	premiumFeatures: DEFAULT_PREMIUM_FEATURES,
	gdriveToken: undefined,
	gdriveRefreshToken: undefined,
	gdriveSaveLocation: undefined,
	autoSyncEnabled: false,
	autoSyncIntervalHours: 24,
};
