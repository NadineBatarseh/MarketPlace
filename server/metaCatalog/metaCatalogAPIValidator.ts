import type {
  ProductSyncInput,
  ValidationResult,
  ValidationFailure,
  MetaCurrency,
} from './metaCatalogAPITypes.js';

const SUPPORTED_CURRENCIES: MetaCurrency[] = ['ILS', 'JOD', 'USD'];

/**
 * Validates a list of products before sending to Meta's items_batch API.
 * Returns { valid, failures } so callers can proceed with only clean items
 * and surface row-level errors for the rest.
 */
export function validateProducts(products: ProductSyncInput[]): ValidationResult {
  const valid: ProductSyncInput[] = [];
  const failures: ValidationFailure[] = [];

  for (const p of products) {
    const retailer_id = p.meta_product_id ?? p.id;
    const errors: string[] = [];

    // retailer_id must always be resolvable
    if (!retailer_id) {
      errors.push('"id" or "meta_product_id" is required to identify the item');
    }

    if (!p.deleted) {
      // title is required for CREATE / UPDATE
      if (!p.title?.trim()) {
        errors.push('"title" is required');
      } else if (p.title.trim().length > 200) {
        errors.push('"title" must be 200 characters or fewer');
      }

      // price must be a non-negative number
      if (p.price == null) {
        errors.push('"price" is required');
      } else if (typeof p.price !== 'number' || isNaN(p.price) || p.price < 0) {
        errors.push(`"price" must be a non-negative number (got: ${p.price})`);
      }

      // currency must be one of the supported codes
      if (p.currency && !SUPPORTED_CURRENCIES.includes(p.currency)) {
        errors.push(
          `"currency" must be one of ${SUPPORTED_CURRENCIES.join(', ')} (got: ${p.currency})`
        );
      }
    }

    if (errors.length > 0) {
      failures.push({ retailer_id: retailer_id ?? '(unknown)', errors });
    } else {
      valid.push(p);
    }
  }

  return { valid, failures };
}

/**
 * Formats a price number and currency into Meta's required string format.
 * Example: formatMetaPrice(12.5, 'ILS') → "12.50 ILS"
 */
export function formatMetaPrice(price: number, currency: MetaCurrency = 'ILS'): string {
  return `${price.toFixed(2)} ${currency}`;
}
