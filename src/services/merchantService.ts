/**
 * RESPONSIBILITY:
 * Handles merchant data operations by communicating with Supabase Edge Functions.
 * The actual saving and encryption happen in the cloud for maximum security.
 */
import { supabase } from '../lib/supabase.js';

export class MerchantService {
  /**
   * Save or update merchant token via the secure Edge Function.
   * This ensures the token is encrypted using pgsodium before hitting the database.
   * * @param sb_auth_token - The JWT of the logged-in user
   * @param catalogId - The Meta Catalog ID
   * @param facebookToken - The token received from Meta
   */
  async saveMerchantTokenSecurely(sb_auth_token: string, facebookToken: string): Promise<{ data: any; error: any }> {
    // بدلاً من الحفظ المباشر، نقوم باستدعاء الحارس (Edge Function)
    const { data, error } = await supabase.functions.invoke('store-catalog-token', {
      headers: {
        Authorization: `Bearer ${sb_auth_token}`,
      },
      body: { 
        token: facebookToken, 
        provider: 'facebook' 
      },
    });

    if (error) {
      console.error("❌ MerchantService: فشل حفظ التوكن عبر الدالة الآمنة:", error);
    } else {
      console.log("✅ MerchantService: تم تشفير وحفظ التوكن بنجاح في السحاب.");
    }

    return { data, error };
  }
}