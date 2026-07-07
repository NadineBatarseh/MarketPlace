import type { Tool } from "@modelcontextprotocol/sdk/types.js";

export const INSTAGRAM_TOOLS: Tool[] = [
  {
    name: "instagram_list_accounts",
    description: "List all available Instagram Business accounts connected to your Facebook pages.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "instagram_get_profile",
    description: "Get Instagram profile information including followers, bio, and media count.",
    inputSchema: {
      type: "object",
      properties: {
        account_id: { type: "string", description: "Instagram Business Account ID. Auto-detected if not provided." },
      },
    },
  },
  {
    name: "instagram_get_account_insights",
    description: "Get account-level insights and analytics for Instagram. Supports demographic breakdowns and time series data.",
    inputSchema: {
      type: "object",
      properties: {
        metrics: {
          type: "array",
          items: { type: "string" },
          description: "Metrics to retrieve (e.g., reach, views, accounts_engaged, follower_demographics, likes, shares)",
        },
        period: {
          type: "string",
          enum: ["day", "week", "days_28", "lifetime"],
          description: "Aggregation period",
        },
        account_id: { type: "string", description: "Instagram Business Account ID. Auto-detected if not provided." },
        metric_type: { type: "string", enum: ["time_series", "total_value"] },
        breakdown: { type: "string", description: "Demographic breakdown: age, city, country, or gender" },
        timeframe: {
          type: "string",
          enum: ["last_14_days", "last_30_days", "last_90_days", "prev_month", "this_month", "this_week"],
        },
        since: { type: "number", description: "Unix timestamp for start of range" },
        until: { type: "number", description: "Unix timestamp for end of range" },
      },
      required: ["metrics", "period"],
    },
  },
  {
    name: "instagram_list_media",
    description: "List recent Instagram media posts with captions, types, and engagement data.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Number of posts to return (default: 25)" },
        account_id: { type: "string", description: "Instagram Business Account ID. Auto-detected if not provided." },
      },
    },
  },
  {
    name: "instagram_get_media_details",
    description: "Get detailed information about a specific Instagram media post.",
    inputSchema: {
      type: "object",
      properties: {
        media_id: { type: "string", description: "Instagram Media ID" },
      },
      required: ["media_id"],
    },
  },
  {
    name: "instagram_get_media_insights",
    description: "Get performance insights for a specific Instagram media post (views, likes, reach, saves, shares, etc.).",
    inputSchema: {
      type: "object",
      properties: {
        media_id: { type: "string", description: "Instagram Media ID" },
        metrics: {
          type: "array",
          items: { type: "string" },
          description: "Metrics to retrieve (e.g., views, likes, comments, reach, saved, shares, total_interactions)",
        },
        period: {
          type: "string",
          enum: ["day", "week", "days_28", "lifetime"],
          description: "Aggregation period (default: lifetime)",
        },
      },
      required: ["media_id", "metrics"],
    },
  },
  {
    name: "instagram_get_stories",
    description: "Get recent Instagram Stories (available within 24 hours after publication).",
    inputSchema: {
      type: "object",
      properties: {
        account_id: { type: "string", description: "Instagram Business Account ID. Auto-detected if not provided." },
      },
    },
  },
  {
    name: "instagram_get_hashtag_search",
    description: "Search for an Instagram hashtag and retrieve its ID for use in media queries.",
    inputSchema: {
      type: "object",
      properties: {
        hashtag_name: { type: "string", description: "Hashtag name to search for (without the # symbol)" },
        account_id: { type: "string", description: "Instagram Business Account ID. Auto-detected if not provided." },
      },
      required: ["hashtag_name"],
    },
  },
  {
    name: "instagram_get_hashtag_media",
    description: "Get top or recent media for a specific hashtag (limited to 30 unique hashtag searches per 7 days).",
    inputSchema: {
      type: "object",
      properties: {
        hashtag_id: { type: "string", description: "Hashtag ID from instagram_get_hashtag_search" },
        media_type: {
          type: "string",
          enum: ["top_media", "recent_media"],
          description: "Whether to retrieve top or recent media (default: top_media)",
        },
        account_id: { type: "string", description: "Instagram Business Account ID. Auto-detected if not provided." },
        limit: { type: "number", description: "Number of media items to return" },
      },
      required: ["hashtag_id"],
    },
  },
  {
    name: "instagram_get_content_publishing_limit",
    description: "Check the current content publishing rate limit and quota usage for an Instagram account.",
    inputSchema: {
      type: "object",
      properties: {
        account_id: { type: "string", description: "Instagram Business Account ID. Auto-detected if not provided." },
      },
    },
  },
  {
    name: "instagram_get_mentioned_media",
    description: "Get media posts where the Instagram account is tagged or mentioned by others.",
    inputSchema: {
      type: "object",
      properties: {
        account_id: { type: "string", description: "Instagram Business Account ID. Auto-detected if not provided." },
        limit: { type: "number", description: "Number of results to return" },
      },
    },
  },
  {
    name: "instagram_search_posts",
    description:
      "Search recent Instagram posts by keyword in their caption and extract product details using AI. Returns a list of detected products for the user to review — does NOT save anything. After reviewing, use instagram_save_drafts to save selected products.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Keyword or phrase to search for in post captions (case-insensitive).",
        },
        limit: {
          type: "number",
          description: "Max number of recent posts to scan before filtering (default: 100, max: 100).",
        },
        account_id: {
          type: "string",
          description: "Instagram Business Account ID. Auto-detected if not provided.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "instagram_save_drafts",
    description:
      "Save a list of selected products as drafts in the database. Use after instagram_search_posts — pass the products the user confirmed they want to save.",
    inputSchema: {
      type: "object",
      properties: {
        shop_id: {
          type: "string",
          description: "The merchant's shop ID.",
        },
        products: {
          type: "array",
          description: "Array of products to save (from instagram_search_posts results).",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              description: { type: "string" },
              price: { type: "number" },
              image_urls: { type: "array", items: { type: "string" } },
              video_url: { type: "string" },
              stock_Quantity: { type: "number" },
              instagram_post_id: { type: "string" },
              instagram_permalink: { type: "string" },
              instagram_timestamp: { type: "string" },
            },
            required: ["title", "instagram_post_id"],
          },
        },
      },
      required: ["shop_id", "products"],
    },
  },
  {
    name: "instagram_import_products",
    description:
      "Scan recent Instagram posts, use AI to identify product showcases, and automatically save them to the database as draft products. Returns a summary object { success, count, message } — does NOT return the product list. The merchant reviews drafts at /merchant-dashboard?page=drafts.",
    inputSchema: {
      type: "object",
      properties: {
        shop_id: {
          type: "string",
          description: "The merchant's shop ID. Must be passed automatically from the authenticated session.",
        },
        limit: {
          type: "number",
          description: "Number of recent posts to scan (default: 25, max: 50)",
        },
        account_id: {
          type: "string",
          description: "Instagram Business Account ID. Auto-detected if not provided.",
        },
        product_type: {
          type: "string",
          description: "Optional: specific product type or material to filter for (e.g. 'تيشيرتات', 'فساتين', 'أحذية', 'قطن', 't-shirts', 'dresses', 'shoes'). When provided, only posts that match this specific type or material will be imported — everything else is skipped. Works for any language, material, or category.",
        },
      },
      required: ["shop_id"],
    },
  },
  {
    name: "instagram_publish_product",
    description:
      "Publish a product to Instagram. Two ways to call it: " +
      "(1) Auto mode — pass only productId (optionally customCaption, hashtags, dryRun): the tool fetches the product and its shop from Supabase itself, uses the product's first image, generates an Arabic caption unless customCaption is given, and publishes via the INSTAGRAM_ACCESS_TOKEN/INSTAGRAM_IG_USER_ID account. Set dryRun to true to preview the caption without publishing. " +
      "(2) Merchant mode — pass shop_id, product_id, and image_urls (1-10 of the product's own images) to post as a feed/carousel post to that merchant's connected Instagram account.",
    inputSchema: {
      type: "object",
      properties: {
        productId: { type: "string", description: "Auto mode: the product ID to publish. The tool fetches its title, description, price, image, and shop name from Supabase." },
        customCaption: { type: "string", description: "Auto mode: caption text to use instead of the auto-generated Arabic caption." },
        hashtags: {
          type: "array",
          items: { type: "string" },
          description: "Auto mode: hashtags to append to the caption (with or without a leading #).",
        },
        dryRun: { type: "boolean", description: "Auto mode: if true, only generate/return the caption — do not publish to Instagram." },
        shop_id: { type: "string", description: "Merchant mode: the merchant's shop ID." },
        product_id: { type: "string", description: "Merchant mode: the product ID to publish." },
        image_urls: {
          type: "array",
          items: { type: "string" },
          description: "Merchant mode: 1-10 publicly accessible HTTPS image URLs, each one of the product's own image_urls.",
        },
        caption: { type: "string", description: "Merchant mode: caption text to post. If omitted, one is generated from the product's title/price/description." },
        account_id: { type: "string", description: "Instagram Business Account ID. Auto-detected if not provided." },
      },
    },
  },
];

export const FACEBOOK_TOOLS: Tool[] = [
  {
    name: "facebook_list_pages",
    description: "List all Facebook Pages accessible with the current access token.",
    inputSchema: {
      type: "object",
      properties: {
        access_token: { type: "string", description: "Facebook access token. Uses configured token if not provided." },
      },
    },
  },
  {
    name: "facebook_get_page_details",
    description: "Get detailed information about a Facebook Page including fans, location, and contact info.",
    inputSchema: {
      type: "object",
      properties: {
        page_id: { type: "string", description: "Facebook Page ID. Uses configured page ID if not provided." },
      },
    },
  },
  {
    name: "facebook_get_page_insights",
    description: "Fetch page-level insights for a Facebook Page. Common metrics: page_impressions, page_engaged_users, page_views_total, page_fans.",
    inputSchema: {
      type: "object",
      properties: {
        metrics: { type: "array", items: { type: "string" }, description: "Metrics to retrieve" },
        page_id: { type: "string" },
        period: { type: "string", enum: ["day", "week", "days_28", "lifetime"] },
        since: { type: "string", description: "Start date (YYYY-MM-DD or Unix timestamp)" },
        until: { type: "string", description: "End date (YYYY-MM-DD or Unix timestamp)" },
        limit: { type: "number" },
        after: { type: "string" },
        before: { type: "string" },
        access_token: { type: "string" },
      },
      required: ["metrics"],
    },
  },
  {
    name: "facebook_get_post_insights",
    description: "Get insights for a specific Facebook post.",
    inputSchema: {
      type: "object",
      properties: {
        post_id: { type: "string", description: "Facebook Post ID" },
        metrics: { type: "array", items: { type: "string" }, description: "Metrics to retrieve" },
        period: { type: "string" },
        access_token: { type: "string" },
      },
      required: ["post_id", "metrics"],
    },
  },
  {
    name: "facebook_list_posts_with_insights",
    description: "Retrieve Facebook page posts combined with inline performance metrics in a single request.",
    inputSchema: {
      type: "object",
      properties: {
        post_metrics: { type: "array", items: { type: "string" }, description: "Post-level metrics to include" },
        page_id: { type: "string" },
        limit: { type: "number" },
        after: { type: "string" },
        before: { type: "string" },
        access_token: { type: "string" },
      },
      required: ["post_metrics"],
    },
  },
  {
    name: "facebook_get_page_feed",
    description: "Get recent posts from a Facebook Page feed with reactions and engagement data.",
    inputSchema: {
      type: "object",
      properties: {
        page_id: { type: "string" },
        limit: { type: "number" },
      },
    },
  },
  {
    name: "facebook_list_known_metrics",
    description: "List all supported Facebook Page and Post metrics with their valid aggregation periods.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "facebook_validate_token",
    description: "Validate a Facebook access token and return basic account information.",
    inputSchema: {
      type: "object",
      properties: {
        access_token: { type: "string", description: "Facebook access token to validate" },
        fields: { type: "array", items: { type: "string" } },
      },
      required: ["access_token"],
    },
  },
];

export function getAllTools(): Tool[] {
  return [...INSTAGRAM_TOOLS, ...FACEBOOK_TOOLS];
}
