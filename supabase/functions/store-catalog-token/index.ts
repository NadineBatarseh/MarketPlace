// @ts-nocheck
// ✅ تم حذف استيراد serve القديم لأنه مدمج الآن في Deno
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ✅ استخدام Deno.serve بدلاً من serve
Deno.serve(async (req) => {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("🔐 [EDGE FUNCTION] استلام طلب حفظ التوكن");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  
  // معالجة طلبات الـ CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) throw new Error('Missing Authorization header')
    
    const userToken = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(userToken)

    if (userError || !user) throw new Error('Unauthorized')

    const { token, provider } = await req.json()

    // 🛡️ ملاحظة حول التشفير:
    // بما أنكِ ذكرتِ pgsodium في السجلات، تأكدي أن جدول 'user_catalog_keys' 
    // مفعل عليه التشفير في قاعدة البيانات (Supabase Vault / TDE).
    
    const { error } = await supabaseClient
      .from('user_catalog_keys')
      .upsert({ 
        user_id: user.id, 
        access_token: token, // سيتم تشفيره في قاعدة البيانات إذا كان pgsodium مفعلاً
        provider: provider 
      })

    if (error) throw error

    return new Response(JSON.stringify({ message: "Done Securely" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    })

  } catch (error) {
    console.error("❌ [EDGE FUNCTION] خطأ:", error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 400,
    })
  }
})