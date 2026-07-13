import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { InstagramClient } from './platforms/instagram/client.js';
import { FacebookClient } from './platforms/facebook/client.js';
import { extractProductsFromPosts } from './utils/extractProducts.js';
import { InstagramApiError } from './utils/errors.js';

function getServiceRoleClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set');
  return createClient(url, key);
}

function buildCaption(product: { title: string; description?: string | null; price?: number | null }): string {
  const priceLine = product.price != null ? `السعر: ${product.price} ₪` : '';
  return [product.title, priceLine, product.description ?? ''].filter(Boolean).join('\n\n');
}

function buildHashtagsLine(hashtags?: string[]): string {
  if (!hashtags?.length) return '';
  return hashtags
    .map((h) => h.trim())
    .filter(Boolean)
    .map((h) => (h.startsWith('#') ? h : `#${h}`))
    .join(' ');
}

function buildAutoPublishCaption(
  product: { title: string; description?: string | null; price?: number | null },
  shopName: string | null
): string {
  const lines = [`✨ ${product.title} ✨`];
  if (product.description) lines.push(product.description);
  if (product.price != null) lines.push(`💰 السعر: ${product.price} ₪`);
  if (shopName) lines.push(`🏬 المتجر: ${shopName}`);
  lines.push('🛍️ تسوقوا الآن عبر تطبيق SouqLink');
  return lines.join('\n\n');
}

interface AutoPublishResult {
  success: boolean;
  message: string;
  productId: string;
  caption?: string;
  mediaId?: string;
}

async function logPublishAttempt(
  db: SupabaseClient,
  params: {
    productId: string;
    shopId: string | null;
    caption: string;
    imageUrl: string;
    status: 'published' | 'failed';
    mediaId?: string;
    errorMessage?: string;
  }
): Promise<void> {
  try {
    await db.from('instagram_publish_logs').insert({
      product_id: params.productId,
      shop_id: params.shopId,
      caption: params.caption,
      image_url: params.imageUrl,
      media_id: params.mediaId ?? null,
      status: params.status,
      error_message: params.errorMessage ?? null,
    });
  } catch {
    // Best-effort logging only — must never mask the actual publish result.
  }
}

/**
 * Auto-publish flow: fetches the product (and shop name) straight from Supabase and
 * publishes it to the calling merchant's own connected Instagram account (the `client`
 * already resolved for this request) — no shop_id/image_urls need to be supplied by the
 * caller. Never falls back to a shared/platform account.
 */
async function publishProductAuto(
  args: Record<string, unknown>,
  client: InstagramClient | null,
  userId?: string
): Promise<AutoPublishResult> {
  const productId = ((args.productId as string | undefined) ?? (args.product_id as string | undefined))?.trim();
  if (!productId) {
    return { success: false, message: 'productId is required.', productId: '' };
  }

  const dryRun = Boolean(args.dryRun);
  const customCaption = (args.customCaption as string | undefined)?.trim();
  const hashtagsLine = buildHashtagsLine(args.hashtags as string[] | undefined);

  const db = getServiceRoleClient();

  type ProductRow = {
    id: string;
    title: string;
    description: string | null;
    price: number | null;
    image_urls: string[] | null;
    shop_id: string;
  };
  let product: ProductRow | null;
  try {
    const { data, error } = await db
      .from('products')
      .select('id, title, description, price, image_urls, shop_id')
      .eq('id', productId)
      .maybeSingle();
    if (error) return { success: false, message: `Supabase error while fetching product: ${error.message}`, productId };
    product = data as ProductRow | null;
  } catch (err) {
    return { success: false, message: `Supabase error while fetching product: ${err instanceof Error ? err.message : String(err)}`, productId };
  }

  if (!product) {
    return { success: false, message: 'المنتج غير موجود.', productId };
  }

  if (userId) await assertShopOwnership(product.shop_id, userId);

  const imageUrl = product.image_urls?.[0];
  if (!imageUrl) {
    return { success: false, message: 'لا يمكن نشر هذا المنتج لعدم وجود صورة.', productId };
  }

  let shopName: string | null = null;
  try {
    const { data: shop, error: shopErr } = await db
      .from('shops')
      .select('name')
      .eq('shop_id', product.shop_id)
      .maybeSingle();
    if (shopErr) return { success: false, message: `Supabase error while fetching shop: ${shopErr.message}`, productId };
    shopName = (shop?.name as string | undefined) ?? null;
  } catch (err) {
    return { success: false, message: `Supabase error while fetching shop: ${err instanceof Error ? err.message : String(err)}`, productId };
  }

  const baseCaption = customCaption || buildAutoPublishCaption(product, shopName);
  const caption = hashtagsLine ? `${baseCaption}\n\n${hashtagsLine}` : baseCaption;

  if (dryRun) {
    return { success: true, message: 'معاينة الكابشن فقط — لم يتم النشر على انستقرام.', productId, caption };
  }

  if (!client) {
    return {
      success: false,
      message: 'لم يتم ربط حساب انستقرام بهذا الحساب. يرجى الربط أولاً من إعدادات المتجر.',
      productId,
      caption,
    };
  }

  let mediaId: string;
  try {
    const result = await client.publishProductPost([imageUrl], caption, args.account_id as string | undefined);
    mediaId = result.mediaId;
  } catch (err) {
    const message =
      err instanceof InstagramApiError
        ? err.message
        : `فشل النشر على انستقرام: ${err instanceof Error ? err.message : String(err)}`;
    await logPublishAttempt(db, { productId, shopId: product.shop_id, caption, imageUrl, status: 'failed', errorMessage: message });
    return { success: false, message, productId, caption };
  }

  await logPublishAttempt(db, { productId, shopId: product.shop_id, caption, imageUrl, status: 'published', mediaId });
  await db
    .from('products')
    .update({ instagram_published_media_id: mediaId, instagram_published_at: new Date().toISOString() })
    .eq('id', productId);

  return { success: true, message: 'تم نشر المنتج على انستقرام بنجاح.', productId, caption, mediaId };
}

async function assertShopOwnership(shopId: string, userId: string): Promise<void> {
  const db = getServiceRoleClient();
  const { data } = await db
    .from('shops')
    .select('shop_id, merchants!inner(user_id)')
    .eq('shop_id', shopId)
    .eq('merchants.user_id', userId)
    .maybeSingle();
  if (!data) throw new Error('Access denied: this store does not belong to your account.');
}

async function handlePublishProduct(
  client: InstagramClient | null,
  args: Record<string, unknown>,
  userId?: string
): Promise<unknown> {
  const shopId = args.shop_id as string | undefined;
  const productId = args.product_id as string | undefined;
  const imageUrls = args.image_urls as string[] | undefined;

  // Simplified auto flow: only productId (+ optional customCaption/hashtags/dryRun) was
  // given — fetch the product/shop from Supabase ourselves instead of requiring the
  // caller to pass shop_id/image_urls explicitly. Publishes via the caller's own
  // connected Instagram client — never falls back to a shared/platform account.
  if (!shopId || !imageUrls?.length) {
    return publishProductAuto(args, client, userId);
  }

  if (!productId) throw new Error('product_id is required');
  if (imageUrls.length > 10) throw new Error('image_urls must contain at most 10 images');
  if (!client) {
    throw new Error(
      'Instagram client not initialized. Please set INSTAGRAM_ACCESS_TOKEN in your environment variables.'
    );
  }
  if (userId) await assertShopOwnership(shopId, userId);

  const db = getServiceRoleClient();
  const { data: product, error: prodErr } = await db
    .from('products')
    .select('id, title, description, price, image_urls')
    .eq('id', productId)
    .eq('shop_id', shopId)
    .maybeSingle();
  if (prodErr || !product) throw new Error('Product not found for this shop.');

  const ownImageUrls = new Set((product.image_urls as string[] | null) ?? []);
  const invalidUrl = imageUrls.find((url) => !ownImageUrls.has(url));
  if (invalidUrl) throw new Error('One or more image_urls do not belong to this product.');

  const caption = (args.caption as string | undefined)?.trim() || buildCaption(product);

  const { mediaId } = await client.publishProductPost(
    imageUrls,
    caption,
    args.account_id as string | undefined
  );

  await db
    .from('products')
    .update({ instagram_published_media_id: mediaId, instagram_published_at: new Date().toISOString() })
    .eq('id', productId);

  return { success: true, media_id: mediaId, caption };
}

export async function handleInstagramTool(
  client: InstagramClient | null,
  name: string,
  args: Record<string, unknown>,
  userId?: string
 ): Promise<unknown> {
  // instagram_publish_product's auto flow (productId-only) supports dryRun with no
  // client at all, so it must not be blocked by the shared-client guard below — it
  // does its own null check on `client` once it knows dryRun isn't set.
  if (name === 'instagram_publish_product') {
    return handlePublishProduct(client, args, userId);
  }

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

    case 'instagram_list_media': {
      const result = await client.getMedia(
        (args.limit as number | undefined) ?? 25,
        args.account_id as string | undefined
      );
      return result.data;
    }

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

    case 'instagram_search_posts': {
      const query = (args.query as string | undefined)?.trim().toLowerCase();
      if (!query) throw new Error('query is required');

      const fetchLimit = Math.min((args.limit as number | undefined) ?? 100, 100);
      const { data: posts } = await client.getMedia(fetchLimit, args.account_id as string | undefined);

      const matched = posts.filter((p) => p.caption?.toLowerCase().includes(query));

      if (matched.length === 0) {
        return { matched_posts: 0, products: [], message: `No posts found containing "${args.query}".` };
      }

      const products = await extractProductsFromPosts(matched);

      if (products.length === 0) {
        return { matched_posts: matched.length, products: [], message: `Found ${matched.length} matching post(s) but no products were detected.` };
      }

      return {
        matched_posts: matched.length,
        products,
        message: `Found ${products.length} product(s) in ${matched.length} matching post(s). Review and use instagram_save_drafts to save selected ones.`,
      };
    }

    case 'instagram_save_drafts': {
      const shopId = args.shop_id as string;
      if (!shopId) throw new Error('shop_id is required');
      if (userId) await assertShopOwnership(shopId, userId);

      const selectedProducts = args.products as Array<{
        title: string;
        description?: string | null;
        price?: number | null;
        image_urls?: string[];
        video_url?: string | null;
        stock_Quantity?: number | null;
        instagram_post_id: string;
        instagram_permalink?: string;
        instagram_timestamp?: string;
      }>;

      if (!selectedProducts?.length) {
        return { success: true, count: 0, message: 'No products provided.' };
      }

      const db = getServiceRoleClient();

      async function uploadMediaToStorage(cdnUrl: string, productId: string, filename: string): Promise<string> {
        try {
          const res = await fetch(cdnUrl);
          if (!res.ok) return cdnUrl;
          const contentType = res.headers.get('content-type') ?? 'application/octet-stream';
          const ext = contentType.split('/')[1]?.split(';')[0] ?? 'bin';
          const path = `${productId}/${filename}.${ext}`;
          const buffer = Buffer.from(await res.arrayBuffer());
          const { error } = await db.storage.from('product-images').upload(path, buffer, { contentType, upsert: true });
          if (error) return cdnUrl;
          return db.storage.from('product-images').getPublicUrl(path).data.publicUrl;
        } catch {
          return cdnUrl;
        }
      }

      const rows = await Promise.all(selectedProducts.map(async (p) => {
        const id = crypto.randomUUID();
        const resolvedUrls = p.image_urls?.length
          ? await Promise.all(p.image_urls.map((url, i) => uploadMediaToStorage(url, id, String(i))))
          : [];
        const resolvedVideoUrl = p.video_url
          ? await uploadMediaToStorage(p.video_url, id, 'reel')
          : null;
        return {
          id,
          shop_id: shopId,
          title: p.title,
          description: p.description ?? null,
          price: p.price ?? null,
          image_urls: resolvedUrls.length > 0 ? resolvedUrls : null,
          video_url: resolvedVideoUrl,
          stock_Quantity: p.stock_Quantity ?? null,
          isPublish: false,
          meta_product_id: crypto.randomUUID(),
          instagram_post_id: p.instagram_post_id ?? null,
        };
      }));

      const { error } = await db.from('products').insert(rows);
      if (error) throw new Error(`فشل حفظ المسودات: ${error.message}`);

      return {
        success: true,
        count: rows.length,
        message: `تم حفظ ${rows.length} منتج كمسودة بنجاح.`,
      };
    }

    case 'instagram_import_products': {
      const shopId = args.shop_id as string;
      if (!shopId) throw new Error('shop_id is required');
      if (userId) await assertShopOwnership(shopId, userId);

      const db = getServiceRoleClient();

      // Fetch store category for vision-based fallback on caption-less posts
      const { data: shopData } = await db
        .from('shops')
        .select('Type_of_store')
        .eq('shop_id', shopId)
        .single();
      const storeCategory = (shopData?.Type_of_store as string | undefined) ?? undefined;
      console.log(`[instagram_import] shop_id: ${shopId} — Type_of_store: ${storeCategory ?? 'NOT SET (no category filtering will apply)'}`);

      async function uploadMediaToStorage(cdnUrl: string, productId: string, filename: string): Promise<string> {
        console.log(`[instagram_import] uploading ${filename} for product ${productId} — url: ${cdnUrl}`);
        try {
          const res = await fetch(cdnUrl);
          if (!res.ok) {
            console.error(`[instagram_import] fetch failed — status ${res.status} ${res.statusText} — url: ${cdnUrl}`);
            return cdnUrl;
          }
          const contentType = res.headers.get('content-type') ?? 'application/octet-stream';
          const ext = contentType.split('/')[1]?.split(';')[0] ?? 'bin';
          const path = `${productId}/${filename}.${ext}`;
          const buffer = Buffer.from(await res.arrayBuffer());
          const { error } = await db.storage.from('product-images').upload(path, buffer, { contentType, upsert: true });
          if (error) {
            console.error(`[instagram_import] storage upload failed — path: ${path} — error: ${error.message}`);
            return cdnUrl;
          }
          const publicUrl = db.storage.from('product-images').getPublicUrl(path).data.publicUrl;
          console.log(`[instagram_import] uploaded successfully — public url: ${publicUrl}`);
          return publicUrl;
        } catch (err: unknown) {
          console.error(`[instagram_import] unexpected error uploading ${filename} for product ${productId}:`, err);
          return cdnUrl;
        }
      }

      // Fetch already-imported post IDs for this shop
      const { data: existingRows } = await db
        .from('products')
        .select('instagram_post_id')
        .eq('shop_id', shopId)
        .not('instagram_post_id', 'is', null);
      const importedIds = new Set((existingRows ?? []).map((r: { instagram_post_id: string }) => r.instagram_post_id));

      // Paginate through Instagram posts (25 per page, up to 4 pages = 100 posts max)
      // until we find posts not yet imported, or exhaust all pages
      const BATCH_SIZE = 25;
      const MAX_PAGES = 4;
      let newPosts: Awaited<ReturnType<typeof client.getMedia>>['data'] = [];
      let totalChecked = 0;
      let cursor: string | undefined = undefined;
      let pagesFetched = 0;

      while (pagesFetched < MAX_PAGES) {
        const { data: batch, nextCursor } = await client.getMedia(BATCH_SIZE, args.account_id as string | undefined, cursor);
        totalChecked += batch.length;

        const newInBatch = batch.filter((p) => !importedIds.has(p.id));
        if (newInBatch.length > 0) {
          newPosts = newInBatch;
          break;
        }

        if (!nextCursor || batch.length === 0) break;
        cursor = nextCursor;
        pagesFetched++;
      }

      if (newPosts.length === 0) {
        return {
          success: true,
          count: 0,
          message: `تم فحص آخر ${totalChecked} منشور على حسابك في انستقرام — جميعها تم استيرادها مسبقاً. لا توجد منشورات جديدة لم يتم استيرادها بعد.`,
        };
      }

      const productType = (args.product_type as string | undefined)?.trim() || undefined;
      const products = await extractProductsFromPosts(newPosts, storeCategory, productType);

      if (products.length === 0) {
        return { success: true, count: 0, message: 'لم يتم العثور على منتجات في آخر المنشورات.' };
      }

      const rows = await Promise.all(products.map(async (p) => {
        const id = crypto.randomUUID();
        const resolvedUrls = p.image_urls.length > 0
          ? await Promise.all(p.image_urls.map((url, i) => uploadMediaToStorage(url, id, String(i))))
          : [];
        const resolvedVideoUrl = p.video_url
          ? await uploadMediaToStorage(p.video_url, id, 'reel')
          : null;
        return {
          id,
          shop_id: shopId,
          title: p.title,
          description: p.description ?? null,
          price: p.price ?? null,
          image_urls: resolvedUrls.length > 0 ? resolvedUrls : null,
          video_url: resolvedVideoUrl,
          stock_Quantity: p.stock_Quantity ?? null,
          isPublish: false,
          meta_product_id: crypto.randomUUID(),
          instagram_post_id: p.instagram_post_id ?? null,
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
