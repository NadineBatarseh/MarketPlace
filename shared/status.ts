// Single source of truth for the order/payment/shipment status vocabulary.
// Imported by both the frontend (src/) and backend (server/) — see each
// directory's tsconfig for why cross-directory relative imports are fine here
// (the project already does this for api/index.ts -> server/index.ts).

/** orders.status — delivery/order lifecycle only. Never holds payment outcomes. */
export type OrderStatus = 'pending' | 'delivering' | 'completed';

/** orders.payment_status — payment outcome only. Never holds delivery state. */
export type PaymentStatus = 'unpaid' | 'pending' | 'paid' | 'failed';

/** shipments.status — per-product fulfilment lifecycle. */
export type ShipmentStatus =
  | 'pending'
  | 'available'
  | 'delayed'
  | 'batched'
  | 'reserved'
  | 'picked_up'
  | 'delivered'
  | 'stranded';
