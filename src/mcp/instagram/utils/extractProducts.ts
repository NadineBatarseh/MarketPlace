import Anthropic from '@anthropic-ai/sdk';
import type { MediaItem } from '../platforms/instagram/types.js';

export interface InstagramProductRecord {
  title: string;
  description: string | null;
  price: number | null;
  image_urls: string[];
  video_url: string | null;
  stock_Quantity: number | null;
  instagram_post_id: string;
  instagram_permalink: string;
  instagram_timestamp: string;
}

interface ClaudeTextResult {
  index: number;
  // false = text is too vague/general to identify the product → trigger vision fallback
  text_sufficient: boolean;
  is_product: boolean;
  matches_store_type: boolean;
  title: string | null;
  description: string | null;
  price: number | null;
  stock_quantity: number | null;
}

interface ClaudeVisionResult {
  is_product: boolean;
  matches_store_type: boolean;
  title: string | null;
  description: string | null;
  price: number | null;
  stock_quantity: number | null;
}

function getPostMedia(post: MediaItem): { imageUrls: string[]; videoUrl: string | null } {
  let imageUrls: string[];
  let videoUrl: string | null = null;

  if (post.media_type === 'CAROUSEL_ALBUM' && post.children?.data?.length) {
    imageUrls = post.children.data
      .map((child) =>
        child.media_type === 'VIDEO'
          ? (child.thumbnail_url ?? child.media_url)
          : child.media_url
      )
      .filter((url): url is string => !!url);
  } else if (post.media_type === 'VIDEO' || post.media_type === 'REELS') {
    imageUrls = post.thumbnail_url ? [post.thumbnail_url] : [];
    videoUrl = post.media_url ?? null;
  } else {
    imageUrls = post.media_url ? [post.media_url] : [];
  }

  return { imageUrls, videoUrl };
}

function getPostFirstImage(post: MediaItem): string | null {
  if (post.media_type === 'CAROUSEL_ALBUM' && post.children?.data?.length) {
    const first = post.children.data[0];
    return first.media_type === 'VIDEO'
      ? (first.thumbnail_url ?? first.media_url ?? null)
      : (first.media_url ?? null);
  }
  if (post.media_type === 'VIDEO' || post.media_type === 'REELS') {
    return post.thumbnail_url ?? null;
  }
  return post.media_url ?? null;
}

function buildProductRecord(
  post: MediaItem,
  result: { title: string | null; description: string | null; price: number | null; stock_quantity: number | null }
): InstagramProductRecord | null {
  if (!result.title) return null;
  const { imageUrls, videoUrl } = getPostMedia(post);
  return {
    title: result.title,
    description: result.description ?? null,
    price: typeof result.price === 'number' ? result.price : null,
    image_urls: imageUrls,
    video_url: videoUrl,
    stock_Quantity: typeof result.stock_quantity === 'number' ? result.stock_quantity : null,
    instagram_post_id: post.id,
    instagram_permalink: post.permalink ?? '',
    instagram_timestamp: post.timestamp,
  };
}

async function fetchImageAsBase64(url: string): Promise<{ data: string; mediaType: string } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') ?? 'image/jpeg';
    const mediaType = contentType.split(';')[0].trim();
    const buffer = Buffer.from(await res.arrayBuffer());
    return { data: buffer.toString('base64'), mediaType };
  } catch {
    return null;
  }
}

async function runVisionOnPost(
  post: MediaItem,
  storeCategory: string,
  client: Anthropic,
  productType?: string
): Promise<InstagramProductRecord | null> {
  const imageUrl = getPostFirstImage(post);
  if (!imageUrl) return null;

  const imageData = await fetchImageAsBase64(imageUrl);
  if (!imageData) return null;

  const filterLine = productType
    ? `The merchant wants ONLY products of this specific type or material: "${productType}". Ignore everything else.`
    : `The store category is: "${storeCategory}".`;

  const matchRule = productType
    ? `- "matches_store_type": true only if the product visually IS a "${productType}" — be strict, do not include loosely related items`
    : `- "matches_store_type": true only if the product visually fits the category "${storeCategory}"`;

  let message;
  try {
    message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: imageData.mediaType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
                data: imageData.data,
              },
            },
            {
              type: 'text',
              text: `You are a product catalog extraction assistant for an e-commerce marketplace.
${filterLine}

Analyze this Instagram post image. Determine if it shows a product for sale that matches the filter.
Also look for any text, price tags, or labels visible inside the image itself.

Respond with a JSON object only (no markdown, no code blocks):
{
  "is_product": true,
  "matches_store_type": true,
  "title": "Concise product name (10 words max, no hashtags, no emojis)",
  "description": "Features, material, size, colour visible in the image",
  "price": null,
  "stock_quantity": null
}

Rules:
- "is_product": true only if the image clearly shows a specific product being sold
${matchRule}
- If either flag is false, set title/description/price/stock_quantity all to null
- "price": a plain number if visible anywhere in the image, otherwise null
- "stock_quantity": null unless explicitly shown in the image`,
            },
          ],
        },
      ],
    });
  } catch {
    return null;
  }

  const rawText = message.content[0].type === 'text' ? message.content[0].text : '';

  let parsed: ClaudeVisionResult;
  try {
    parsed = JSON.parse(rawText.trim());
  } catch {
    const match = rawText.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return null;
    }
  }

  if (!parsed.is_product || !parsed.matches_store_type) return null;

  return buildProductRecord(post, parsed);
}

export async function extractProductsFromPosts(
  posts: MediaItem[],
  storeCategory?: string,
  productType?: string
): Promise<InstagramProductRecord[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');

  const client = new Anthropic({ apiKey });
  const products: InstagramProductRecord[] = [];

  // Posts with a caption go through text stage first.
  // Posts with no caption at all skip directly to vision.
  const captionPosts = posts.filter((p) => p.caption && p.caption.trim().length > 0);
  const visionQueue: MediaItem[] = posts.filter((p) => !p.caption || p.caption.trim().length === 0);

  // ── Stage 1: Text analysis ──────────────────────────────────────────────────
  if (captionPosts.length > 0) {
    // product_type takes priority over storeCategory for the filter instruction
    const filterLine = productType
      ? `The merchant wants ONLY products of this specific type or material: "${productType}". Ignore any post that does not match this — even if it's a valid product in the store category.`
      : storeCategory
        ? `The store category is: "${storeCategory}". Only products that match this category should be imported.`
        : '';

    const matchRule = productType
      ? `- "matches_store_type": true ONLY if the product IS a "${productType}" (use semantic understanding — e.g. "قميص" and "تيشيرت" both match "t-shirts"). Be strict: do not include loosely related items`
      : `- "matches_store_type": true if the product fits the store category${storeCategory ? ` "${storeCategory}"` : ' — set true when no category is defined'}`;

    const prompt = `You are a product catalog extraction assistant for an e-commerce marketplace.
${filterLine}

Given a list of Instagram post captions (may include hashtags), determine for each post:
1. Whether the text clearly identifies a specific product being sold ("text_sufficient")
2. Whether that product matches the filter
3. Extract product details from the text

Respond with a JSON array only (no markdown, no code blocks) — one object per post, in the same order:
[
  {
    "index": 0,
    "text_sufficient": true,
    "is_product": true,
    "matches_store_type": true,
    "title": "Concise product name (10 words max)",
    "description": "Product description cleaned of hashtags and price lines",
    "price": 29.99,
    "stock_quantity": null
  }
]

Rules for "text_sufficient":
- Set to FALSE if the caption is any of these:
    * Only generic hashtags with no specific product name (e.g. #fashion #style #trending)
    * Only emojis or decorative symbols
    * A general greeting or phrase ("Blessed Friday", "Good morning") with no product mention
    * Too vague to clearly identify what is being sold
- Set to TRUE only when the text clearly names or describes a specific product

Rules for other fields:
- "is_product": true only if the post is clearly selling a specific product
${matchRule}
- When "text_sufficient" is false, set is_product/matches_store_type/title/description/price/stock_quantity all to their null/false defaults
- "title": product name only — short, no hashtags, no emojis
- "description": features, material, size, colour from the caption
- "price": plain number, strip currency symbols, convert Arabic-Indic digits, use lowest if multiple
- "stock_quantity": null unless explicitly mentioned

Posts:
${JSON.stringify(captionPosts.map((p, i) => ({ index: i, caption: p.caption })), null, 2)}`;

    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    });

    const rawText = message.content[0].type === 'text' ? message.content[0].text : '';

    let extracted: ClaudeTextResult[];
    try {
      extracted = JSON.parse(rawText.trim());
    } catch {
      const match = rawText.match(/\[[\s\S]*\]/);
      if (!match) throw new Error('Claude returned invalid JSON during product extraction');
      extracted = JSON.parse(match[0]);
    }

    for (const result of extracted) {
      const post = captionPosts[result.index];
      if (!post) continue;

      if (!result.text_sufficient) {
        // Text was too vague — fall back to vision
        visionQueue.push(post);
        continue;
      }

      // Text was sufficient but post is not a product, or doesn't match store type
      if (!result.is_product || !result.title) continue;
      if (storeCategory && !result.matches_store_type) continue;

      const record = buildProductRecord(post, result);
      if (record) products.push(record);
    }
  }

  // ── Stage 2: Vision fallback ────────────────────────────────────────────────
  // Runs for: (a) posts with no caption, (b) posts whose caption was too vague
  // Requires either a productType or storeCategory to have a meaningful filter
  const visionFilter = productType ?? storeCategory;
  if (visionQueue.length > 0 && visionFilter) {
    const visionResults = await Promise.all(
      visionQueue.map((post) => runVisionOnPost(post, visionFilter, client, productType))
    );
    for (const record of visionResults) {
      if (record) products.push(record);
    }
  }

  return products;
}
