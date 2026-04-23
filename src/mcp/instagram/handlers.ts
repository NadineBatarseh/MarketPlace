import { createClient } from '@supabase/supabase-js';
import { InstagramClient } from './platforms/instagram/client.js';
import { FacebookClient } from './platforms/facebook/client.js';
import { extractProductsFromPosts } from './utils/extractProducts.js';

function getServiceRoleClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set');
  return createClient(url, key);
}

export async function handleInstagramTool(
  client: InstagramClient | null,
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  if (!client) {
    throw new Error(
      'Instagram client not initialized. Please set INSTAGRAM_ACCESS_TOKEN in your environment variables.'
    );
  }

  switch (name) {
    case 'instagram_list_accounts':
      return client.getAvailableAccounts();

    case 'instagram_get_profile':
      return client.getUserProfile(args.account_id as string | undefined);

    case 'instagram_get_account_insights':
      return client.getAccountInsights(
        (args.metrics as string[]) as any,
        args.period as 'day' | 'week' | 'days_28' | 'lifetime',
        {
          accountId: args.account_id as string | undefined,
          metricType: args.metric_type as 'time_series' | 'total_value' | undefined,
          breakdown: args.breakdown as any,
          timeframe: args.timeframe as any,
          since: args.since as number | undefined,
          until: args.until as number | undefined,
        }
      );

    case 'instagram_list_media':
      return client.getMedia(
        (args.limit as number | undefined) ?? 25,
        args.account_id as string | undefined
      );

    case 'instagram_get_media_details':
      return client.getMediaById(args.media_id as string);

    case 'instagram_get_media_insights':
      return client.getMediaInsights(
        args.media_id as string,
        (args.metrics as string[]) as any,
        (args.period as 'day' | 'week' | 'days_28' | 'lifetime' | undefined) ?? 'lifetime'
      );

    case 'instagram_get_stories':
      return client.getStories(args.account_id as string | undefined);

    case 'instagram_get_hashtag_search': {
      const hashtagId = await client.searchHashtag(
        args.hashtag_name as string,
        args.account_id as string | undefined
      );
      return { hashtag_id: hashtagId };
    }

    case 'instagram_get_hashtag_media':
      return client.getHashtagMedia(
        args.hashtag_id as string,
        (args.media_type as 'top_media' | 'recent_media' | undefined) ?? 'top_media',
        args.account_id as string | undefined,
        args.limit as number | undefined
      );

    case 'instagram_get_content_publishing_limit':
      return client.getContentPublishingLimit(args.account_id as string | undefined);

    case 'instagram_get_mentioned_media':
      return client.getMentionedMedia(
        args.account_id as string | undefined,
        args.limit as number | undefined
      );

    case 'instagram_import_products': {
      const shopId = args.shop_id as string;
      if (!shopId) throw new Error('shop_id is required for instagram_import_products');

      const limit = Math.min((args.limit as number | undefined) ?? 25, 50);
      const posts = await client.getMedia(limit, args.account_id as string | undefined);
      const products = await extractProductsFromPosts(posts);

      if (products.length === 0) {
        return { success: true, count: 0, message: 'لم يتم العثور على منتجات في آخر المنشورات.' };
      }

      const db = getServiceRoleClient();

      // Upload each Instagram CDN image to Supabase Storage immediately so
      // the draft rows hold permanent URLs regardless of when the merchant publishes.
      async function uploadToStorage(
        cdnUrl: string,
        productId: string,
        index: number
      ): Promise<string> {
        console.log(`[instagram_import] uploading image ${index} for product ${productId} — url: ${cdnUrl}`);
        try {
          const res = await fetch(cdnUrl);
          if (!res.ok) {
            console.error(`[instagram_import] fetch failed — status ${res.status} ${res.statusText} — url: ${cdnUrl}`);
            return cdnUrl;
          }
          const contentType = res.headers.get('content-type') ?? 'image/jpeg';
          if (!contentType.startsWith('image/')) {
            console.error(`[instagram_import] unexpected content-type "${contentType}" — url: ${cdnUrl}`);
            return cdnUrl;
          }
          const ext = contentType.split('/')[1]?.split(';')[0] ?? 'jpg';
          const path = `${productId}/${index}.${ext}`;
          const buffer = Buffer.from(await res.arrayBuffer());
          console.log(`[instagram_import] uploading to storage path: ${path} (${buffer.byteLength} bytes)`);
          const { error } = await db.storage
            .from('product-images')
            .upload(path, buffer, { contentType, upsert: true });
          if (error) {
            console.error(`[instagram_import] storage upload failed — path: ${path} — error: ${error.message}`);
            return cdnUrl;
          }
          const publicUrl = db.storage.from('product-images').getPublicUrl(path).data.publicUrl;
          console.log(`[instagram_import] image uploaded successfully — public url: ${publicUrl}`);
          return publicUrl;
        } catch (err: unknown) {
          console.error(`[instagram_import] unexpected error uploading image ${index} for product ${productId}:`, err);
          return cdnUrl;
        }
      }

      const rows = await Promise.all(products.map(async (p) => {
        const id = crypto.randomUUID();
        const resolvedUrls = p.image_urls.length > 0
          ? await Promise.all(p.image_urls.map((url, i) => uploadToStorage(url, id, i)))
          : [];
        return {
          id,
          shop_id: shopId,
          title: p.title,
          description: p.description ?? null,
          price: p.price ?? null,
          image_urls: resolvedUrls.length > 0 ? resolvedUrls : null,
          stock_Quantity: p.stock_Quantity ?? null,
          isPublish: false,
          meta_product_id: crypto.randomUUID(),
        };
      }));

      const { error } = await db.from('products').insert(rows);
      if (error) throw new Error(
        `فشل حفظ المسودات في قاعدة البيانات: ${error.message}. ` +
        `تأكد من تشغيل migration لإضافة عمود isPublish في جدول products.`
      );

      return {
        success: true,
        count: rows.length,
        message: `تم حفظ ${rows.length} منتجاً كمسودة بنجاح.`,
      };
    }

    default:
      throw new Error(`Unknown Instagram tool: ${name}`);
  }
}

export async function handleFacebookTool(
  client: FacebookClient | null,
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  if (!client) {
    throw new Error(
      'Facebook client not initialized. Please set FACEBOOK_ACCESS_TOKEN in your environment variables.'
    );
  }

  switch (name) {
    case 'facebook_list_pages':
      return client.listPages(args.access_token as string | undefined);

    case 'facebook_get_page_details':
      return client.getPageDetails(args.page_id as string | undefined);

    case 'facebook_get_page_insights':
      return client.getPageInsights({
        metrics: args.metrics as string[],
        pageId: args.page_id as string | undefined,
        period: args.period as string | undefined,
        since: args.since as string | undefined,
        until: args.until as string | undefined,
        limit: args.limit as number | undefined,
        after: args.after as string | undefined,
        before: args.before as string | undefined,
        accessToken: args.access_token as string | undefined,
      });

    case 'facebook_get_post_insights':
      return client.getPostInsights({
        postId: args.post_id as string,
        metrics: args.metrics as string[],
        period: args.period as string | undefined,
        accessToken: args.access_token as string | undefined,
      });

    case 'facebook_list_posts_with_insights':
      return client.listPostsWithInsights({
        postMetrics: args.post_metrics as string[],
        pageId: args.page_id as string | undefined,
        limit: args.limit as number | undefined,
        after: args.after as string | undefined,
        before: args.before as string | undefined,
        accessToken: args.access_token as string | undefined,
      });

    case 'facebook_get_page_feed':
      return client.getPageFeed(
        args.page_id as string | undefined,
        args.limit as number | undefined
      );

    case 'facebook_list_known_metrics':
      return client.listKnownMetrics();

    case 'facebook_validate_token':
      return client.validateAccessToken({
        accessToken: args.access_token as string,
        apiVersion: args.api_version as string | undefined,
        fields: args.fields as string[] | undefined,
      });

    default:
      throw new Error(`Unknown Facebook tool: ${name}`);
  }
}
