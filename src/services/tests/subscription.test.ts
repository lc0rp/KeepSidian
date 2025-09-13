import { SubscriptionService } from '../subscription';
import { SubscriptionInfo, SubscriptionCache } from '../../types/subscription';
import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import * as obsidian from 'obsidian';

// Mock Obsidian requestUrl + Notice
jest.mock('obsidian', () => ({
  Notice: class {
    constructor(public message: string) {}
  },
  requestUrl: jest.fn(),
}));

global.console.error = jest.fn();

describe('SubscriptionService', () => {
  let service: SubscriptionService;
  let mockGetEmail: jest.MockedFunction<() => string>;
  let mockGetCache: jest.MockedFunction<() => SubscriptionCache | undefined>;
  let mockSetCache: jest.MockedFunction<(cache: SubscriptionCache) => Promise<void>>;

  const mockEmail = 'test@example.com';
  const mockSubscriptionInfo: SubscriptionInfo = {
    subscription_status: 'active',
    plan_details: {
      plan_id: 'premium',
      features: ['feature1', 'feature2']
    },
    metering_info: {
      usage: 50,
      limit: 100
    },
    trial_or_promo: null
  };

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    // Start of Selection

    // Setup mock functions with proper types
    mockGetEmail = jest.fn<() => string>().mockReturnValue(mockEmail);
    mockGetCache = jest.fn<() => SubscriptionCache | undefined>().mockReturnValue(undefined);
    mockSetCache = jest.fn<(cache: SubscriptionCache) => Promise<void>>().mockResolvedValue();

    // Create service instance
    service = new SubscriptionService(
      mockGetEmail,
      mockGetCache,
      mockSetCache
    );

    // Reset requestUrl mock
    (obsidian.requestUrl as jest.Mock).mockReset();
  });

  describe('checkSubscription', () => {
    it('should return null if no email is provided', async () => {
      mockGetEmail.mockReturnValue('');
      const result = await service.checkSubscription();
      expect(result).toBeNull();
      expect(obsidian.requestUrl).not.toHaveBeenCalled();
    });

    it('should use cached data if available and not expired', async () => {
      const cachedInfo: SubscriptionCache = {
        info: mockSubscriptionInfo,
        timestamp: Date.now() - 1000, // 1 second ago
        email: mockEmail
      };
      mockGetCache.mockReturnValue(cachedInfo);

      const result = await service.checkSubscription();
      expect(result).toEqual(mockSubscriptionInfo);
      expect(obsidian.requestUrl).not.toHaveBeenCalled();
    });

    it('should fetch new data if cache is expired', async () => {
      const cachedInfo: SubscriptionCache = {
        info: mockSubscriptionInfo,
        timestamp: Date.now() - (25 * 60 * 60 * 1000), // 25 hours ago
        email: mockEmail
      };
      mockGetCache.mockReturnValue(cachedInfo);

      const mockResponse = {
        status: 200,
        json: mockSubscriptionInfo,
      };
      (obsidian.requestUrl as any).mockResolvedValueOnce(mockResponse);

      const result = await service.checkSubscription();
      expect(result).toEqual(mockSubscriptionInfo);
      expect(obsidian.requestUrl).toHaveBeenCalledTimes(1);
      expect(mockSetCache).toHaveBeenCalled();
    });

    it('should fetch new data if email changed', async () => {
      const cachedInfo: SubscriptionCache = {
        info: mockSubscriptionInfo,
        timestamp: Date.now() - 1000, // 1 second ago
        email: 'old@example.com'
      };
      mockGetCache.mockReturnValue(cachedInfo);

      // Create a proper Response mock
      const mockResponse = {
        status: 200,
        json: mockSubscriptionInfo,
      };
      (obsidian.requestUrl as any).mockResolvedValueOnce(mockResponse);

      const result = await service.checkSubscription();
      expect(result).toEqual(mockSubscriptionInfo);
      expect(obsidian.requestUrl).toHaveBeenCalledTimes(1);
      expect(mockSetCache).toHaveBeenCalled();
    });

    it('should force refresh when forceRefresh is true', async () => {
      const cachedInfo: SubscriptionCache = {
        info: mockSubscriptionInfo,
        timestamp: Date.now() - 1000, // 1 second ago
        email: mockEmail
      };
      mockGetCache.mockReturnValue(cachedInfo);

      // Create a proper Response mock
      const mockResponse = {
        status: 200,
        json: mockSubscriptionInfo,
      };
      (obsidian.requestUrl as any).mockResolvedValueOnce(mockResponse);

      const result = await service.checkSubscription(true);
      expect(result).toEqual(mockSubscriptionInfo);
      expect(obsidian.requestUrl).toHaveBeenCalledTimes(1);
      expect(mockSetCache).toHaveBeenCalled();
    });

    it('should handle API errors gracefully', async () => {
      // Create a proper error Response mock
      const mockResponse = {
        status: 400,
        json: { error: 'API Error' },
      };
      (obsidian.requestUrl as any).mockResolvedValueOnce(mockResponse);

      const result = await service.checkSubscription();
      expect(result).toBeNull();
      expect(console.error).toHaveBeenCalled();
      expect(mockSetCache).not.toHaveBeenCalled();
    });

    it('should handle network errors gracefully', async () => {
      (obsidian.requestUrl as any).mockRejectedValueOnce(new Error('Network error'));

      const result = await service.checkSubscription();
      expect(result).toBeNull();
      expect(console.error).toHaveBeenCalled();
      expect(mockSetCache).not.toHaveBeenCalled();
    });
  });

  describe('isSubscriptionActive', () => {
    it('should return true for active subscription', async () => {
      // Mock checkSubscription to return active subscription
      jest.spyOn(service, 'checkSubscription').mockResolvedValue(mockSubscriptionInfo);

      const result = await service.isSubscriptionActive();
      expect(result).toBe(true);
    });

    it('should return false for inactive subscription', async () => {
      const inactiveInfo: SubscriptionInfo = {
        ...mockSubscriptionInfo,
        subscription_status: 'inactive'
      };
      jest.spyOn(service, 'checkSubscription').mockResolvedValue(inactiveInfo);

      const result = await service.isSubscriptionActive();
      expect(result).toBe(false);
    });

    it('should return false for expired subscription', async () => {
      const expiredInfo: SubscriptionInfo = {
        ...mockSubscriptionInfo,
        subscription_status: 'expired'
      };
      jest.spyOn(service, 'checkSubscription').mockResolvedValue(expiredInfo);

      const result = await service.isSubscriptionActive();
      expect(result).toBe(false);
    });

    it('should return false for null subscription info', async () => {
      jest.spyOn(service, 'checkSubscription').mockResolvedValue(null);

      const result = await service.isSubscriptionActive();
      expect(result).toBe(false);
    });

    it('should pass forceRefresh parameter to checkSubscription', async () => {
      const checkSubscriptionSpy = jest.spyOn(service, 'checkSubscription').mockResolvedValue(mockSubscriptionInfo);

      await service.isSubscriptionActive(true);
      expect(checkSubscriptionSpy).toHaveBeenCalledWith(true);
    });
  });
}); 
