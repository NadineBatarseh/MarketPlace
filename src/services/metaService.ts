export class MetaService {
  private baseUrl: string;
  private accessToken: string;
  private catalogId: string;

  constructor(accessToken: string, catalogId: string, version = "v18.0") {
    this.accessToken = accessToken;
    this.catalogId = catalogId;
    this.baseUrl = `https://graph.facebook.com/${version}`;
  }

  /**
   * دالة جديدة لتحويل التوكين القصير إلى طويل الأمد (60 يوم)
   */
  async exchangeForLongLivedToken(shortLivedToken: string): Promise<any> {
    const url = `${this.baseUrl}/oauth/access_token?` +
      `grant_type=fb_exchange_token&` +
      `client_id=${process.env.META_APP_ID}&` +
      `client_secret=${process.env.META_APP_SECRET}&` +
      `fb_exchange_token=${shortLivedToken}`;

    const response = await fetch(url);
    const data: any = await response.json();

    if (data.access_token) {
      // تحديث التوكين في الخدمة فوراً بالنوع الطويل
      this.updateAccessToken(data.access_token);
    }
    
    return data;
  }

  public updateAccessToken(newToken: string): void {
    this.accessToken = newToken;
    console.log("🔄 MetaService: تم تحديث الـ Access Token بنجاح.");
  }

  async getCatalogProducts() {
    const url = `${this.baseUrl}/${this.catalogId}/products?fields=id,name,description,price,currency,image_url,url,availability,brand,category&limit=25&access_token=${this.accessToken}`;
    const response = await fetch(url);
    return response.json();
  }

  async getProduct(productId: string) {
    const url = `${this.baseUrl}/${productId}?fields=id,name,description,price,currency,image_url,url,availability,brand,category&access_token=${this.accessToken}`;
    const response = await fetch(url);
    return response.json();
  }

  async searchProducts(query: string) {
    const data: any = await this.getCatalogProducts();
    return data.data?.filter((p: any) => 
      p.name.toLowerCase().includes(query.toLowerCase())
    ) || [];
  }
}