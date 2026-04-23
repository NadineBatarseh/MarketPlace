/**
 * Instagram Graph API Client
 * Handles all API requests to Instagram Graph API
 */

import axios, { AxiosInstance } from 'axios';
import { requestWithRetry } from '../../utils/retry.js';
import { InstagramApiError } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';
import {
  InstagramConfig,
  AccountInsight,
  MediaInsight,
  MediaItem,
  StoryItem,
  UserProfile,
  InsightsResponse,
  MediaResponse,
  StoryResponse,
  HashtagSearchResponse,
  HashtagMediaResponse,
  ContentPublishingLimitResponse,
  AccountMetric,
  MediaMetric,
  Period,
  MetricType,
  BreakdownType,
  Timeframe,
  DemographicBreakdown,
} from './types.js';

const DEFAULT_API_VERSION = 'v23.0';

export class InstagramClient {
  private axiosInstance: AxiosInstance;
  private accessToken: string;
  private accountId?: string;

  constructor(config: InstagramConfig) {
    this.accessToken = config.accessToken;
    this.accountId = config.accountId;

    const apiVersion = config.apiVersion || DEFAULT_API_VERSION;
    const baseURL = `https://graph.facebook.com/${apiVersion}`;

    this.axiosInstance = axios.create({
      baseURL,
      params: {
        access_token: this.accessToken,
      },
    });

    logger.debug('Instagram client initialized', { apiVersion });
  }

  async getAvailableAccounts(): Promise<Array<{ id: string; username: string; name: string; pageId: string; pageName: string }>> {
    try {
      const response = await this.request<{ data: Array<{ id: string; name: string }> }>({
        url: '/me/accounts',
      });
      const pages = response.data;

      if (!pages || pages.length === 0) {
        throw new InstagramApiError({
          message: 'No Facebook pages found. Please connect a Facebook page to your Instagram Business account.',
        });
      }

      const accounts = [];
      for (const page of pages) {
        try {
          const igResponse = await this.request<{
            instagram_business_account?: { id: string; username?: string; name?: string };
          }>({
            url: `/${page.id}`,
            params: {
              fields: 'instagram_business_account{id,username,name}',
              access_token: this.accessToken,
            },
          });

          if (igResponse.instagram_business_account) {
            accounts.push({
              id: igResponse.instagram_business_account.id,
              username: igResponse.instagram_business_account.username || 'Unknown',
              name: igResponse.instagram_business_account.name || 'Unknown',
              pageId: page.id,
              pageName: page.name,
            });
          }
        } catch {
          continue;
        }
      }

      if (accounts.length === 0) {
        throw new InstagramApiError({
          message: 'No Instagram Business accounts found. Please ensure at least one Instagram account is connected to your Facebook pages.',
        });
      }

      return accounts;
    } catch (error) {
      if (error instanceof InstagramApiError) throw error;
      throw this.wrapError('Failed to get available accounts', error);
    }
  }

  async getAccountId(): Promise<string> {
    if (this.accountId) {
      return this.accountId;
    }

    const accounts = await this.getAvailableAccounts();

    if (accounts.length === 1) {
      this.accountId = accounts[0].id;
      logger.info(`Using Instagram account: @${accounts[0].username}`);
      return this.accountId;
    }

    const accountList = accounts
      .map((acc, idx) => `${idx + 1}. @${acc.username} (${acc.name}) - ID: ${acc.id}`)
      .join('\n');

    throw new InstagramApiError({
      message: `Multiple Instagram accounts found. Please specify which account to use by adding the account_id parameter:\n\n${accountList}\n\nExample:\n{\n  "account_id": "${accounts[0].id}"\n}`,
    });
  }

  async getUserProfile(accountId?: string): Promise<UserProfile> {
    try {
      const targetAccountId = accountId || (await this.getAccountId());
      return await this.request<UserProfile>({
        url: `/${targetAccountId}`,
        params: {
          fields: 'id,username,name,profile_picture_url,followers_count,follows_count,media_count,biography,website',
        },
      });
    } catch (error) {
      if (error instanceof InstagramApiError) throw error;
      throw this.wrapError('Failed to get user profile', error);
    }
  }

  async getAccountInsights(
    metrics: AccountMetric[],
    period: Period,
    options?: {
      since?: number;
      until?: number;
      accountId?: string;
      metricType?: MetricType;
      breakdown?: BreakdownType | DemographicBreakdown;
      timeframe?: Timeframe;
    }
  ): Promise<AccountInsight[]> {
    try {
      const targetAccountId = options?.accountId || (await this.getAccountId());

      const demographicMetrics = [
        'engaged_audience_demographics',
        'follower_demographics',
        'reached_audience_demographics',
        'threads_follower_demographics',
      ];
      const hasDemographicMetrics = metrics.some((m) => demographicMetrics.includes(m));

      let breakdown = options?.breakdown;
      if (hasDemographicMetrics && !breakdown) {
        breakdown = 'country';
      }

      const params: Record<string, unknown> = {
        metric: metrics.join(','),
        period,
      };

      if (options?.metricType) params.metric_type = options.metricType;
      if (breakdown) params.breakdown = breakdown;
      if (options?.timeframe) params.timeframe = options.timeframe;
      if (options?.since) params.since = options.since;
      if (options?.until) params.until = options.until;

      const response = await this.request<InsightsResponse>({
        url: `/${targetAccountId}/insights`,
        params,
      });

      return response.data as AccountInsight[];
    } catch (error) {
      if (error instanceof InstagramApiError) throw error;
      throw this.wrapError('Failed to get account insights', error);
    }
  }

  async getCarouselChildren(mediaId: string): Promise<Array<{ id: string; media_url?: string; thumbnail_url?: string; media_type: 'IMAGE' | 'VIDEO' }>> {
    try {
      const response = await this.request<{ data: Array<{ id: string; media_url?: string; thumbnail_url?: string; media_type: 'IMAGE' | 'VIDEO' }> }>({
        url: `/${mediaId}/children`,
        params: { fields: 'id,media_url,thumbnail_url,media_type' },
      });
      return response.data ?? [];
    } catch (error) {
      logger.warn(`Failed to fetch carousel children for ${mediaId}:`, error);
      return [];
    }
  }

  async getMedia(limit: number = 25, accountId?: string): Promise<MediaItem[]> {
    try {
      const targetAccountId = accountId || (await this.getAccountId());
      const response = await this.request<MediaResponse>({
        url: `/${targetAccountId}/media`,
        params: {
          fields: 'id,caption,media_type,media_url,permalink,timestamp,like_count,comments_count,media_product_type,thumbnail_url',
          limit,
        },
      });
      const media = response.data;

      // Fetch all children for carousel posts via the dedicated edge (nested fields only return 1 by default)
      await Promise.all(
        media
          .filter((item) => item.media_type === 'CAROUSEL_ALBUM')
          .map(async (item) => {
            const children = await this.getCarouselChildren(item.id);
            item.children = { data: children };
          })
      );

      return media;
    } catch (error) {
      if (error instanceof InstagramApiError) throw error;
      throw this.wrapError('Failed to get media', error);
    }
  }

  async getMediaInsights(mediaId: string, metrics: MediaMetric[], period: Period = 'lifetime'): Promise<MediaInsight[]> {
    try {
      const response = await this.request<InsightsResponse>({
        url: `/${mediaId}/insights`,
        params: {
          metric: metrics.join(','),
          period,
        },
      });
      return response.data as MediaInsight[];
    } catch (error) {
      if (error instanceof InstagramApiError) throw error;
      throw this.wrapError('Failed to get media insights', error);
    }
  }

  async getMediaById(mediaId: string): Promise<MediaItem> {
    try {
      const item = await this.request<MediaItem>({
        url: `/${mediaId}`,
        params: {
          fields: 'id,caption,media_type,media_url,permalink,timestamp,like_count,comments_count,media_product_type,thumbnail_url',
        },
      });
      if (item.media_type === 'CAROUSEL_ALBUM') {
        const children = await this.getCarouselChildren(item.id);
        item.children = { data: children };
      }
      return item;
    } catch (error) {
      if (error instanceof InstagramApiError) throw error;
      throw this.wrapError('Failed to get media details', error);
    }
  }

  async getStories(accountId?: string): Promise<StoryItem[]> {
    try {
      const targetAccountId = accountId || (await this.getAccountId());
      const response = await this.request<StoryResponse>({
        url: `/${targetAccountId}/stories`,
        params: {
          fields: 'id,caption,media_type,media_url,permalink,timestamp',
        },
      });
      return response.data;
    } catch (error) {
      if (error instanceof InstagramApiError) throw error;
      throw this.wrapError('Failed to get stories', error);
    }
  }

  async searchHashtag(hashtagName: string, accountId?: string): Promise<string> {
    try {
      const targetAccountId = accountId || (await this.getAccountId());
      const response = await this.request<HashtagSearchResponse>({
        url: '/ig_hashtag_search',
        params: {
          q: hashtagName,
          user_id: targetAccountId,
        },
      });
      if (!response.data || response.data.length === 0) {
        throw new InstagramApiError({
          message: `No hashtag found for "${hashtagName}"`,
        });
      }
      return response.data[0].id;
    } catch (error) {
      if (error instanceof InstagramApiError) throw error;
      throw this.wrapError('Failed to search hashtag', error);
    }
  }

  async getHashtagMedia(
    hashtagId: string,
    type: 'top_media' | 'recent_media',
    accountId?: string,
    limit?: number
  ): Promise<MediaItem[]> {
    try {
      const targetAccountId = accountId || (await this.getAccountId());
      const response = await this.request<HashtagMediaResponse>({
        url: `/${hashtagId}/${type}`,
        params: {
          user_id: targetAccountId,
          fields: 'id,caption,media_type,media_url,permalink,timestamp,like_count,comments_count',
          limit: limit || 25,
        },
      });
      return response.data;
    } catch (error) {
      if (error instanceof InstagramApiError) throw error;
      throw this.wrapError('Failed to get hashtag media', error);
    }
  }

  async getContentPublishingLimit(accountId?: string): Promise<ContentPublishingLimitResponse> {
    try {
      const targetAccountId = accountId || (await this.getAccountId());
      return await this.request<ContentPublishingLimitResponse>({
        url: `/${targetAccountId}/content_publishing_limit`,
        params: {
          fields: 'config,quota_usage',
        },
      });
    } catch (error) {
      if (error instanceof InstagramApiError) throw error;
      throw this.wrapError('Failed to get content publishing limit', error);
    }
  }

  async getMentionedMedia(accountId?: string, limit?: number): Promise<MediaItem[]> {
    try {
      const targetAccountId = accountId || (await this.getAccountId());
      const response = await this.request<{ data: MediaItem[] }>({
        url: `/${targetAccountId}/tags`,
        params: {
          fields: 'id,caption,media_type,media_url,permalink,timestamp,like_count,comments_count',
          limit: limit || 25,
        },
      });
      return response.data;
    } catch (error) {
      if (error instanceof InstagramApiError) throw error;
      throw this.wrapError('Failed to get mentioned media', error);
    }
  }

  private async request<T>(config: { url: string; params?: Record<string, unknown> }): Promise<T> {
    return requestWithRetry<T>(this.axiosInstance, {
      method: 'GET',
      url: config.url,
      params: config.params,
    });
  }

  private wrapError(context: string, error: unknown): InstagramApiError {
    if (axios.isAxiosError(error)) {
      const apiError = error.response?.data?.error;
      return new InstagramApiError({
        message: `${context}: ${apiError?.message || error.message}`,
        code: apiError?.code || error.response?.status,
        type: apiError?.type,
        fbtrace_id: apiError?.fbtrace_id,
      });
    }
    return new InstagramApiError({
      message: `${context}: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}
