// authService.ts
import "dotenv/config";
import { supabase } from '../lib/supabase.js';

export class AuthService {
  private readonly apiVersion = "v18.0";
  private readonly baseUrl = `https://graph.facebook.com/${this.apiVersion}`;

  /**
   * تبديل الكود بتوكن وحفظه فوراً بشكل مشفر في سوبابيس
   */
  async exchangeAndSecureToken(code: string, redirectUri: string, sb_auth_token: string): Promise<any> {
    console.log("📡 [AUTH SERVICE] بدء تبادل الكود بالتوكن من Meta...");
    
    const params = new URLSearchParams();
    params.append('client_id', process.env.META_APP_ID!);
    params.append('client_secret', process.env.META_APP_SECRET!);
    params.append('redirect_uri', redirectUri);
    params.append('code', code);

    console.log("   - API URL:", `${this.baseUrl}/oauth/access_token`);
    console.log("   - Client ID:", process.env.META_APP_ID ? "✅ موجود" : "❌ غير موجود");

    // 1. طلب التوكن من فيسبوك
    console.log("🔄 [AUTH SERVICE] إرسال طلب إلى Meta API...");
    const response = await fetch(`${this.baseUrl}/oauth/access_token?${params.toString()}`);
    const metaData: any = await response.json();

    console.log("📥 [AUTH SERVICE] استجابة من Meta:");
    console.log("   - Status:", response.status);
    console.log("   - Access Token:", metaData.access_token ? "✅ موجود" : "❌ غير موجود");

    if (metaData.access_token) {
      console.log("🔐 [AUTH SERVICE] بدء حفظ التوكن بشكل مشفر في Supabase...");
      
      // 2. الحفظ المشفر: نرسله فوراً لـ Edge Function
      const { data, error } = await supabase.functions.invoke('store-catalog-token', {
        headers: {
          Authorization: `Bearer ${sb_auth_token}`,
        },
        body: { 
          token: metaData.access_token, 
          provider: 'facebook' 
        },
      });

      if (error) {
        console.error("❌ [AUTH SERVICE] فشل حفظ التوكن في Supabase:");
        console.error("   - Error:", error.message);
        throw new Error(`Failed to secure token: ${error.message}`);
      }
      
      console.log("✅ [AUTH SERVICE] تم حفظ التوكن بنجاح في Supabase (مشفر)");
      return { success: true, message: "Token secured and encrypted" };
    }

    console.error("❌ [AUTH SERVICE] لم يتم استلام التوكن من Meta");
    console.error("   - Error:", metaData.error);
    return metaData;
  }

  /**
   * بناء redirect_uri. إذا وُجد META_REDIRECT_URI في .env نستخدمه (مفيد مع ngrok).
   */
  buildRedirectUri(protocol: string, host: string, path: string = "/auth/callback"): string {
    const fromEnv = process.env.META_REDIRECT_URI;
    if (fromEnv && fromEnv.trim()) {
      console.log("   - استخدام META_REDIRECT_URI من .env:", fromEnv);
      return fromEnv.trim();
    }
    return `${protocol}://${host}${path}`;
  }
}