// services/metaService.ts
import { supabase } from '../lib/supabase.js';
export class MetaService {
    catalogId;
    constructor(catalogId) {
        this.catalogId = catalogId;
        // لم نعد بحاجة لتخزين الـ accessToken هنا لأنه محفوظ ومُشفر في سوبابيس
    }
    /**
     * طلب المنتجات عبر الـ Edge Function
     * @param userToken - توكن JWT الخاص بالمستخدم المسجل في سوبابيس
     */
    async getCatalogProducts(userToken) {
        try {
            const { data, error } = await supabase.functions.invoke('meta-proxy', {
                headers: {
                    Authorization: `Bearer ${userToken}`,
                },
                body: {
                    endpoint: `${this.catalogId}/products`,
                    method: 'GET',
                    params: 'fields=id,name,description,price,currency,image_url,url,availability,brand,category&limit=25'
                },
            });
            if (error)
                throw error;
            return data;
        }
        catch (error) {
            console.error("Error fetching products via Edge Function:", error);
            throw error;
        }
    }
    /**
     * جلب منتج محدد عبر الـ Edge Function
     */
    async getProduct(productId, userToken) {
        try {
            const { data, error } = await supabase.functions.invoke('meta-proxy', {
                headers: {
                    Authorization: `Bearer ${userToken}`,
                },
                body: {
                    endpoint: productId,
                    method: 'GET',
                    params: 'fields=id,name,description,price,currency,image_url,url,availability,brand,category'
                },
            });
            if (error)
                throw error;
            return data;
        }
        catch (error) {
            console.error("Error fetching product details:", error);
            throw error;
        }
    }
    /**
     * البحث عن منتجات بالاسم عبر الـ Edge Function
     * @param query - نص البحث
     * @param userToken - توكن JWT الخاص بالمستخدم المسجل في سوبابيس
     */
    async searchProducts(query, userToken) {
        try {
            const data = await this.getCatalogProducts(userToken);
            // البحث في قائمة المنتجات حسب الاسم
            const filteredProducts = data?.data?.filter((p) => p.name?.toLowerCase().includes(query.toLowerCase())) || [];
            return { data: filteredProducts };
        }
        catch (error) {
            console.error("Error searching products:", error);
            throw error;
        }
    }
}
