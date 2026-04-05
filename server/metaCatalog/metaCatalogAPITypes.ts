export type MetaOperation = 'UPDATE' | 'CREATE' | 'DELETE';

export type MetaAvailability =
  | 'in stock'
  | 'out of stock'
  | 'preorder'
  | 'available for order'
  | 'discontinued';

export type MetaCondition = 'new' | 'refurbished' | 'used';

export type MetaCurrency = 'ILS' | 'JOD' | 'USD';

/** Fields accepted by Meta for a catalog item */
export interface MetaCatalogItemData {
  retailer_id: string;
  id: string;
  item_group_id?: string;
  title: string;
  description?: string;
  /** Formatted as "{amount} {CURRENCY}", e.g. "29.99 ILS" */
  price: string;
  currency?: MetaCurrency;
  availability: MetaAvailability;
  condition: MetaCondition;
  image_link?: string;
  url?: string;
  brand?: string;
}

/** A single entry in the items_batch requests array */
export interface MetaBatchRequest {
  method: MetaOperation;
  retailer_id: string;
  data?: Partial<Omit<MetaCatalogItemData, 'retailer_id'>>;
}

/** Full payload sent to Meta's items_batch endpoint */
export interface MetaBatchPayload {
  allow_upsert: boolean;
  item_type: 'PRODUCT_ITEM';
  requests: MetaBatchRequest[];
}

/** Successful response from Meta items_batch */
export interface MetaBatchResponse {
  handles: string[];
}

/** Meta Graph API error shape */
export interface MetaApiError {
  message: string;
  type: string;
  code: number;
  error_subcode?: number;
  fbtrace_id?: string;
}

/** Result of a single batch sync attempt */
export interface SyncResult {
  ok: boolean;
  handles?: string[];
  itemCount?: number;
  error?: string;
  /** Seconds to wait before retrying (set on rate-limit responses) */
  retryAfter?: number;
}

/** Product data coming from our Supabase DB */
export interface ProductSyncInput {
  /** Internal Supabase UUID — used as retailer_id when meta_product_id is absent */
  id: string;
  /** Set when the product was previously imported from Meta */
  meta_product_id?: string | null;
  title: string;
  description?: string | null;
  price?: number | null;
  image_urls?: string[] | null;
  stock_Quantity?: number | null;
  /** Defaults to 'ILS' when not provided */
  currency?: MetaCurrency;
  /** Defaults to 'new' when not provided */
  condition?: MetaCondition;
  /** When true the item is sent as a DELETE operation */
  deleted?: boolean;
}

/** Input to the syncProductsToMeta function */
export interface CatalogSyncOptions {
  products: ProductSyncInput[];
  /** Override the catalog ID from env */
  catalogId?: string;
  /** Override the access token from env */
  accessToken?: string;
}

/** Validation failure for a single product */
export interface ValidationFailure {
  retailer_id: string;
  errors: string[];
}

/** Result of the pre-request validation pass */
export interface ValidationResult {
  valid: ProductSyncInput[];
  failures: ValidationFailure[];
}
