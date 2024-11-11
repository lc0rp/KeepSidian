import { DEFAULT_PREMIUM_FEATURES, PremiumFeatureSettings, SubscriptionCache } from './subscription';

export interface KeepSidianPluginSettings {
	email: string;
	token: string;
	saveLocation: string;
	subscriptionCache?: SubscriptionCache;
	premiumFeatures: PremiumFeatureSettings;
}

export const DEFAULT_SETTINGS: KeepSidianPluginSettings = {
	email: '',
	token: '',
	saveLocation: 'Google Keep',
	subscriptionCache: undefined,
	premiumFeatures: DEFAULT_PREMIUM_FEATURES
}


