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
  MediaContainerResponse,
  ContainerStatusResponse,
} from './types.js';

const CAROUSEL_MAX_CHILDREN = 10;

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
      logger.warn(`Failed to fetch carousel children for ${mediaId}:`, error as Record<string, unknown>);
      return [];
    }
  }

  async getMedia(
    limit: number = 25,
    accountId?: string,
    after?: string
  ): Promise<{ data: MediaItem[]; nextCursor: string | null }> {
    try {
      const targetAccountId = accountId || (await this.getAccountId());
      const params: Record<string, unknown> = {
        fields: 'id,caption,media_type,media_url,permalink,timestamp,like_count,comments_count,media_product_type,thumbnail_url',
        limit,
      };
      if (after) params.after = after;

      const response = await this.request<MediaResponse>({
        url: `/${targetAccountId}/media`,
        params,
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

      const nextCursor = response.paging?.cursors?.after ?? null;
      return { data: media, nextCursor };
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

  private async post<T>(config: { url: string; params?: Record<string, unknown> }): Promise<T> {
    return requestWithRetry<T>(this.axiosInstance, {
      method: 'POST',
      url: config.url,
      params: config.params,
    });
  }

  private async createMediaContainer(
    imageUrl: string,
    accountId: string,
    opts?: { caption?: string; isCarouselItem?: boolean }
  ): Promise<MediaContainerResponse> {
    try {
      const params: Record<string, unknown> = { image_url: imageUrl };
      if (opts?.isCarouselItem) {
        params.is_carousel_item = true;
      } else if (opts?.caption) {
        params.caption = opts.caption;
      }
      return await this.post<MediaContainerResponse>({
        url: `/${accountId}/media`,
        params,
      });
    } catch (error) {
      if (error instanceof InstagramApiError) throw error;
      throw this.wrapError('Failed to create media container', error);
    }
  }

  private async createCarouselContainer(
    childIds: string[],
    caption: string,
    accountId: string
  ): Promise<MediaContainerResponse> {
    try {
      return await this.post<MediaContainerResponse>({
        url: `/${accountId}/media`,
        params: {
          media_type: 'CAROUSEL_ALBUM',
          children: childIds.join(','),
          caption,
        },
      });
    } catch (error) {
      if (error instanceof InstagramApiError) throw error;
      throw this.wrapError('Failed to create carousel container', error);
    }
  }

  private async getContainerStatus(containerId: string): Promise<ContainerStatusResponse> {
    try {
      return await this.request<ContainerStatusResponse>({
        url: `/${containerId}`,
        params: { fields: 'status_code' },
      });
    } catch (error) {
      if (error instanceof InstagramApiError) throw error;
      throw this.wrapError('Failed to get container status', error);
    }
  }

  private async waitForContainerReady(containerId: string): Promise<void> {
    const maxAttempts = 10;
    const pollIntervalMs = 2000;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const status = await this.getContainerStatus(containerId);
      if (status.status_code === 'FINISHED') return;
      if (status.status_code === 'ERROR' || status.status_code === 'EXPIRED') {
        throw new InstagramApiError({
          message: `Instagram failed to process the media container (status: ${status.status_code}).`,
        });
      }
      await new Promise<void>((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    throw new InstagramApiError({
      message: 'Timed out waiting for Instagram to process the media container.',
    });
  }

  private async publishContainer(containerId: string, accountId: string): Promise<{ id: string }> {
    try {
      return await this.post<{ id: string }>({
        url: `/${accountId}/media_publish`,
        params: { creation_id: containerId },
      });
    } catch (error) {
      if (error instanceof InstagramApiError) throw error;
      throw this.wrapError('Failed to publish media container', error);
    }
  }

  /**
   * Publishes a product's images as a single Instagram feed post (1 image)
   * or a carousel post (2-10 images).
   */
  async publishProductPost(
    imageUrls: string[],
    caption: string,
    accountId?: string
  ): Promise<{ mediaId: string }> {
    if (imageUrls.length === 0) {
      throw new InstagramApiError({ message: 'At least one image is required to publish a post.' });
    }
    if (imageUrls.length > CAROUSEL_MAX_CHILDREN) {
      throw new InstagramApiError({
        message: `Instagram carousels support at most ${CAROUSEL_MAX_CHILDREN} images.`,
      });
    }

    const targetAccountId = accountId || (await this.getAccountId());

    if (imageUrls.length === 1) {
      const container = await this.createMediaContainer(imageUrls[0], targetAccountId, { caption });
      await this.waitForContainerReady(container.id);
      const published = await this.publishContainer(container.id, targetAccountId);
      return { mediaId: published.id };
    }

    const childContainers = await Promise.all(
      imageUrls.map((url) => this.createMediaContainer(url, targetAccountId, { isCarouselItem: true }))
    );
    await Promise.all(childContainers.map((child) => this.waitForContainerReady(child.id)));

    const carouselContainer = await this.createCarouselContainer(
      childContainers.map((child) => child.id),
      caption,
      targetAccountId
    );
    await this.waitForContainerReady(carouselContainer.id);
    const published = await this.publishContainer(carouselContainer.id, targetAccountId);
    return { mediaId: published.id };
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
