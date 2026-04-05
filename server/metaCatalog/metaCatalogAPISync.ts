import type {
  ProductSyncInput,
  MetaBatchRequest,
  MetaBatchPayload,
  MetaBatchResponse,
  MetaApiError,
  SyncResult,
  CatalogSyncOptions,
  MetaAvailability,
  MetaCurrency,
} from './metaCatalogAPITypes.js';
import { formatMetaPrice } from './metaCatalogAPIValidator.js';

/** Meta Graph API version */
const GRAPH_API_VERSION = 'v19.0';

/** Maximum items per batch — Meta recommends ≤ 1000 */
const BATCH_SIZE = 1000;

/**
 * Meta error codes that indicate rate limiting.
 * https://developers.facebook.com/docs/graph-api/overview/rate-limiting/
 */
const RATE_LIMIT_CODES = new Set([4, 17, 32, 613]);

/** Error code for an invalid or expired access token */
const INVALID_TOKEN_CODE = 190;

/* ------------------------------------------------------------------ */
/*  Item mapper                                                         */
/* ------------------------------------------------------------------ */

function toMetaAvailability(stockQty: number | null | undefined): MetaAvailability {
  if (stockQty == null) return 'in stock';
  return stockQty > 0 ? 'in stock' : 'out of stock';
}

function buildBatchRequest(product: ProductSyncInput): MetaBatchRequest {
  const retailer_id = product.meta_product_id ?? product.id;
  const currency: MetaCurrency = product.currency ?? 'ILS';

  if (product.deleted) {
    return { method: 'DELETE', retailer_id, data: { id: retailer_id } };
  }

  // When meta_product_id is already set the item exists in Meta → UPDATE.
  // Otherwise treat as CREATE (allow_upsert: true on the payload handles
  // idempotency, so a re-run won't create duplicates).
  const method = product.meta_product_id ? 'UPDATE' : 'CREATE';

  return {
    method,
    retailer_id,
    data: {
      id: retailer_id,
      title: product.title.trim(),
      description: product.description?.trim() ?? undefined,
      price: formatMetaPrice(product.price!, currency),
      availability: toMetaAvailability(product.stock_Quantity),
      condition: product.condition ?? 'new',
      image_link: product.image_urls?.[0] ?? undefined,
      // url is required by Meta — falls back to the app's public base URL
      url: `${process.env.APP_BASE_URL ?? 'https://attently-hard-juanita.ngrok-free.dev'}/product/${retailer_id}`,
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Error message builder                                               */
/* ------------------------------------------------------------------ */

function buildMetaErrorMessage(
  err: MetaApiError,
  isRateLimit: boolean,
  isInvalidToken: boolean
): string {
  if (isInvalidToken) {
    return `Invalid or expired Meta access token (code ${err.code}). Re-authenticate via /auth/meta.`;
  }
  if (isRateLimit) {
    return `Meta API rate limit hit (code ${err.code}). Retry after 60 seconds.`;
  }
  return `Meta API error (code ${err.code}, type: ${err.type}): ${err.message}`;
}

/* ------------------------------------------------------------------ */
/*  Core batch sender                                                   */
/* ------------------------------------------------------------------ */

async function sendBatch(
  catalogId: string,
  accessToken: string,
  requests: MetaBatchRequest[]
): Promise<SyncResult> {
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${catalogId}/items_batch?access_token=${encodeURIComponent(accessToken)}`;

  const payload: MetaBatchPayload = {
    allow_upsert: true,
    item_type: 'PRODUCT_ITEM',
    requests,
  };

  console.log('[MetaCatalogSync] Payload:', JSON.stringify(payload, null, 2));

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  } catch (networkErr: any) {
    return {
      ok: false,
      error: `Network error: ${networkErr instanceof Error ? networkErr.message : String(networkErr)}`,
    };
  }

  // HTTP 429 — explicit rate-limit response
  if (response.status === 429) {
    const retryAfter = parseInt(response.headers.get('Retry-After') ?? '60', 10);
    return {
      ok: false,
      error: 'Meta API rate limit exceeded (HTTP 429)',
      retryAfter,
    };
  }

  let body: any;
  try {
    body = await response.json();
  } catch {
    return {
      ok: false,
      error: `Non-JSON response from Meta (HTTP ${response.status})`,
    };
  }

  console.log('[MetaCatalogSync] Raw response:', JSON.stringify(body));

  // Meta can return an error object inside a 200 response
  if (body?.error) {
    const metaError = body.error as MetaApiError;
    const isRateLimit = RATE_LIMIT_CODES.has(metaError.code);
    const isInvalidToken = metaError.code === INVALID_TOKEN_CODE;

    console.error(
      `[MetaCatalogSync] Meta API error — code: ${metaError.code}, type: ${metaError.type}, msg: ${metaError.message}`
    );

    return {
      ok: false,
      error: buildMetaErrorMessage(metaError, isRateLimit, isInvalidToken),
      retryAfter: isRateLimit ? 60 : undefined,
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      error: `Meta API responded with HTTP ${response.status}: ${JSON.stringify(body)}`,
    };
  }

  // Meta returns validation_status instead of handles when items fail field validation
  if (body?.validation_status) {
    const allErrors = (body.validation_status as Array<{ errors?: Array<{ message: string }> }>)
      .flatMap((s) => s.errors ?? [])
      .map((e) => e.message);

    if (allErrors.length > 0) {
      console.error(`[MetaCatalogSync] validation_status errors:`, allErrors);
      return { ok: false, error: `Meta field validation failed: ${allErrors.join('; ')}` };
    }
  }

  const data = body as MetaBatchResponse;
  return {
    ok: true,
    handles: data.handles ?? [],
    itemCount: requests.length,
  };
}

/* ------------------------------------------------------------------ */
/*  Public sync function                                                */
/* ------------------------------------------------------------------ */

/**
 * Pushes a list of pre-validated products to Meta's items_batch API.
 *
 * - Automatically chunks into batches of up to BATCH_SIZE (1000) items.
 * - Stops early if a rate-limit or invalid-token error is encountered.
 * - Returns one SyncResult per batch sent.
 *
 * Callers should run validateProducts() before calling this function.
 */
export async function syncProductsToMeta(
  options: CatalogSyncOptions
): Promise<SyncResult[]> {
  const catalogId = options.catalogId ?? process.env.META_CATALOG_ID;
  const accessToken = options.accessToken ?? process.env.META_ACCESS_TOKEN;

  if (!catalogId || !accessToken) {
    return [
      {
        ok: false,
        error:
          'Missing META_CATALOG_ID or META_ACCESS_TOKEN. Set them in .env or pass via options.',
      },
    ];
  }

  if (options.products.length === 0) {
    return [{ ok: true, handles: [], itemCount: 0 }];
  }

  const requests = options.products.map(buildBatchRequest);

  // Split into chunks of BATCH_SIZE
  const batches: MetaBatchRequest[][] = [];
  for (let i = 0; i < requests.length; i += BATCH_SIZE) {
    batches.push(requests.slice(i, i + BATCH_SIZE));
  }

  console.log(
    `[MetaCatalogSync] Sending ${options.products.length} items in ${batches.length} batch(es) to catalog ${catalogId}`
  );

  const results: SyncResult[] = [];

  for (const batch of batches) {
    const result = await sendBatch(catalogId, accessToken, batch);
    results.push(result);

    // Stop processing further batches on rate-limit or auth failures
    if (!result.ok && (result.retryAfter !== undefined || result.error?.includes('token'))) {
      console.warn(`[MetaCatalogSync] Stopping early — ${result.error}`);
      break;
    }
  }

  return results;
}
