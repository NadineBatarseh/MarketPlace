import { AuthService } from '../services/authService.js';
import { MerchantService } from '../services/merchantService.js';
import "dotenv/config";
export class AuthController {
    authService;
    merchantService;
    metaService;
    constructor(metaService) {
        this.authService = new AuthService();
        this.merchantService = new MerchantService();
        this.metaService = metaService;
    }
    /**
     * Handle OAuth callback from Meta
     */
    async handleCallback(req, res) {
        const code = req.query.code;
        // التوكن يمكن أن يأتي من رأس الطلب أو من معامل state (عند إعادة التوجيه من Meta لا يرسل المتصفح Authorization)
        const sb_auth_token = req.headers.authorization?.replace('Bearer ', '') ||
            req.query.state ||
            '';
        if (!code) {
            res.status(400).send("لم يتم استلام كود.");
            return;
        }
        if (!sb_auth_token) {
            res.status(401).send("لم يتم استلام توكن المصادقة. تأكد من تسجيل الدخول أولاً ثم اضغط «احصل على صلاحية الوصول للكتالوج».");
            return;
        }
        try {
            const protocolHeader = req.headers['x-forwarded-proto'];
            const protocol = Array.isArray(protocolHeader) ? protocolHeader[0] : (protocolHeader || req.protocol);
            const host = Array.isArray(req.headers.host) ? req.headers.host[0] : req.headers.host || '';
            const redirectUri = this.authService.buildRedirectUri(protocol, host);
            console.log(`🚀 محاولة التبادل باستخدام: ${redirectUri}`);
            // Exchange code for token and save securely via Edge Function
            const result = await this.authService.exchangeAndSecureToken(code, redirectUri, sb_auth_token);
            if (result.success) {
                console.log("✅ تمت مزامنة بيانات التاجر بنجاح!");
                res.send("<h1>تم الربط والحفظ في Supabase بنجاح! 🎉</h1>");
            }
            else {
                console.error("❌ خطأ من ميتا:", result.error);
                res.status(500).json({
                    error: "فشل التبادل",
                    message: result.error?.message || "Unknown error",
                    type: result.error?.type || "OAuthException"
                });
            }
        }
        catch (error) {
            const message = error?.message || String(error);
            const stack = error?.stack;
            console.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
            console.error("❌ [AUTH] خطأ داخلي في السيرفر");
            console.error("   - Message:", message);
            if (stack)
                console.error("   - Stack:", stack);
            console.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
            res.status(500).send("<h2>خطأ تقني في السيرفر</h2>" +
                "<p>راجع Console السيرفر (الترمينال) لرؤية تفاصيل الخطأ.</p>" +
                "<p><strong>السبب المحتمل:</strong> " + escapeHtml(message) + "</p>");
        }
    }
}
function escapeHtml(text) {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return text.replace(/[&<>"']/g, (c) => map[c] ?? c);
}
