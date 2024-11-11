import { SubscriptionInfo, SubscriptionCache } from '../types/subscription';
import { Notice } from 'obsidian';
import { KEEPSIDIAN_SERVER_URL } from '../config';

const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

export class SubscriptionService {
  constructor(
    private getEmail: () => string,
    private getCache: () => SubscriptionCache | undefined,
    private setCache: (cache: SubscriptionCache) => Promise<void>
  ) { }

  async checkSubscription(forceRefresh = false): Promise<SubscriptionInfo | null> {
    const email = this.getEmail();
    if (!email) {
      return null;
    }

    const cache = this.getCache();
    if (
      !forceRefresh &&
      cache &&
      cache.email === email &&
      Date.now() - cache.timestamp < CACHE_DURATION
    ) {
      return cache.info;
    }

    try {
      const info = await this.fetchSubscriptionInfo(email);
      await this.setCache({
        info,
        timestamp: Date.now(),
        email: email,
      });
      return info;
    } catch (error) {
      console.error('Failed to check subscription:', error);
      new Notice('Failed to check subscription status. Please try again later.');
      return null;
    }
  }

  private async fetchSubscriptionInfo(email: string): Promise<SubscriptionInfo> {
    const response = await fetch(`${KEEPSIDIAN_SERVER_URL}/subscriber/info`, {
      method: 'GET',
      headers: {
        'X-User-Email': email,
      },
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to fetch subscription info');
    }

    return response.json();
  }

  async isSubscriptionActive(forceRefresh = false): Promise<boolean> {
    const info = await this.checkSubscription(forceRefresh);
    return info?.subscription_status === 'active';
  }
} 