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

interface ClaudeExtractionResult {
  index: number;
  is_product: boolean;
  title: string | null;
  description: string | null;
  price: number | null;
  stock_quantity: number | null;
}

export async function extractProductsFromPosts(
  posts: MediaItem[]
): Promise<InstagramProductRecord[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not set');
  }

  const postsWithCaptions = posts.filter(
    (p) => p.caption && p.caption.trim().length > 0
  );

  if (postsWithCaptions.length === 0) {
    return [];
  }

  const client = new Anthropic({ apiKey });

  const postsPayload = postsWithCaptions.map((p, i) => ({
    index: i,
    caption: p.caption,
  }));

  const prompt = `You are a product catalog extraction assistant for an e-commerce marketplace.

Given a list of Instagram post captions from a merchant's account, determine for each post whether it is showcasing a product for sale, and extract the product details.

Respond with a JSON array only (no markdown, no code blocks) — one object per post, in the same order:
[
  {
    "index": 0,
    "is_product": true,
    "title": "Concise product name (10 words max)",
    "description": "Product description cleaned of hashtags and price lines",
    "price": 29.99,
    "stock_quantity": 5
  }
]

Rules:
- Set "is_product" to true ONLY if the post is clearly selling or showcasing a specific product with a name and/or price
- "title" must be the product name only — short, no hashtags, no emojis
- "description" captures features, material, size, colour, etc. from the caption
- "price" must be a plain number (strip all currency symbols). Convert Arabic-Indic digits if present. If multiple prices appear, use the lowest listed price.
- "stock_quantity" is null unless an explicit quantity or stock count is mentioned
- When "is_product" is false, set title/description/price/stock_quantity all to null

Posts:
${JSON.stringify(postsPayload, null, 2)}`;

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2048,
    messages: [{ role: 'user', content: prompt }],
  });

  const rawText =
    message.content[0].type === 'text' ? message.content[0].text : '';

  let extracted: ClaudeExtractionResult[];
  try {
    extracted = JSON.parse(rawText.trim());
  } catch {
    const match = rawText.match(/\[[\s\S]*\]/);
    if (!match) {
      throw new Error(
        'Claude returned invalid JSON during product extraction'
      );
    }
    extracted = JSON.parse(match[0]);
  }

  const products: InstagramProductRecord[] = [];

  for (const result of extracted) {
    if (!result.is_product || !result.title) continue;

    const post = postsWithCaptions[result.index];
    if (!post) continue;

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

    products.push({
      title: result.title,
      description: result.description ?? null,
      price: typeof result.price === 'number' ? result.price : null,
      image_urls: imageUrls,
      video_url: videoUrl,
      stock_Quantity:
        typeof result.stock_quantity === 'number'
          ? result.stock_quantity
          : null,
      instagram_post_id: post.id,
      instagram_permalink: post.permalink ?? '',
      instagram_timestamp: post.timestamp,
    });
  }

  return products;
}
