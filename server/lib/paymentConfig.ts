/**
 * Payment / settlement configuration — single source of truth at runtime.
 *
 * Loads the admin-editable financial knobs from `payment_config` (id = 1) into the
 * in-memory `PC` object, exactly like the logistics engine loads `batch_config` into
 * `C` (see server/logistics/constants.ts). Code reads `PC.*` instead of process.env,
 * so an admin can change commission / delivery fee / settlement timing from the
 * dashboard without a redeploy.
 *
 * Defaults below double as the env fallback used before the first DB load (and if the
 * row can't be read), so behaviour is unchanged when payment_config is absent.
 */
import { supabase } from '../supabase.js';

export const PC = {
  /** Platform commission taken from each shop's gross (0.10 = 10%). */
  platformCommissionRate:         Number(process.env.PLATFORM_COMMISSION_RATE ?? 0.10),
  /** Flat delivery fee: charged to the customer AND paid to the assigned courier. */
  deliveryFee:                    Number(process.env.DELIVERY_FEE ?? 25),
  /** Return window (hours) after delivery before a vendor payout becomes settle-eligible. */
  settlementReturnWindowHours:    Number(process.env.SETTLEMENT_RETURN_WINDOW_HOURS ?? 72),
  /** Max retry attempts per payout line in the settlement sweep. */
  settlementMaxAttempts:          Number(process.env.SETTLEMENT_MAX_ATTEMPTS ?? 3),
  /** How often the in-process settlement sweep runs (minutes). Applied at server start. */
  settlementSweepIntervalMinutes: Number(process.env.SETTLEMENT_SWEEP_INTERVAL_MINUTES ?? 15),
};

export type PaymentConfig = typeof PC;

/**
 * Load the admin-configurable fields from payment_config (id = 1) into PC.
 * Call once at startup, after each admin update, and at the start of each sweep.
 * Falls back to current values (defaults/env) if the row can't be read.
 */
export async function loadPaymentConfig(): Promise<void> {
  const { data, error } = await supabase
    .from('payment_config')
    .select('platform_commission_rate, delivery_fee, settlement_return_window_hours, settlement_max_attempts, settlement_sweep_interval_minutes')
    .eq('id', 1)
    .single();

  if (error || !data) {
    console.warn('[PaymentConfig] Could not load payment_config, using defaults:', error?.message);
    return;
  }

  PC.platformCommissionRate         = Number(data.platform_commission_rate);
  PC.deliveryFee                    = Number(data.delivery_fee);
  PC.settlementReturnWindowHours    = Number(data.settlement_return_window_hours);
  PC.settlementMaxAttempts          = Number(data.settlement_max_attempts);
  PC.settlementSweepIntervalMinutes = Number(data.settlement_sweep_interval_minutes);
}
