export interface SubscriptionInfo {
  subscription_status: 'active' | 'inactive' | 'expired';
  plan_details: {
    plan_id: string;
    features: string[];
  };
  metering_info: {
    usage: number;
    limit: number;
  };
  trial_or_promo: any;
}

export interface SubscriptionCache {
  info: SubscriptionInfo;
  timestamp: number;
  email: string;
}

export interface SubscriptionStatus {
    isActive: boolean;
    expiresAt?: Date;
    plan?: 'basic' | 'premium';
}

export interface PremiumFeatureSettings {
    autoSync: boolean;
    syncIntervalMinutes: number;
    includeNotesTerms: string[];
    excludeNotesTerms: string[];
    updateTitle: boolean;
    suggestTags: boolean;
    maxTags: number;
    tagPrefix: string;
    limitToExistingTags: boolean;
} 

export const DEFAULT_PREMIUM_FEATURES: PremiumFeatureSettings = {
    autoSync: false,
    syncIntervalMinutes: 5,
    includeNotesTerms: [],
    excludeNotesTerms: [],
    updateTitle: false,
    suggestTags: false,
    maxTags: 5,
    tagPrefix: '',
    limitToExistingTags: false
}