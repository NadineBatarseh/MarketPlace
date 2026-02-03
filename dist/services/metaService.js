/**
 * RESPONSIBILITY:
 * This service handles all direct communication with the Meta Graph API.
 * It encapsulates the API logic, endpoints, and data fetching.
 * It returns raw data to the callers and doesn't know anything about MCP.
 */
export class MetaService {
    baseUrl;
    accessToken;
    catalogId;
    constructor(accessToken, catalogId, version = "v18.0") {
        this.accessToken = accessToken;
        this.catalogId = catalogId;
        this.baseUrl = `https://graph.facebook.com/${version}`;
    }
    async getCatalogProducts() {
        const url = `${this.baseUrl}/${this.catalogId}/products?fields=id,name,description,price,currency,image_url,url,availability,brand,category&limit=25&access_token=${this.accessToken}`;
        const response = await fetch(url);
        return response.json();
    }
    async getProduct(productId) {
        const url = `${this.baseUrl}/${productId}?fields=id,name,description,price,currency,image_url,url,availability,brand,category&access_token=${this.accessToken}`;
        const response = await fetch(url);
        return response.json();
    }
    async searchProducts(query) {
        const data = await this.getCatalogProducts();
        return data.data?.filter((p) => p.name.toLowerCase().includes(query.toLowerCase())) || [];
    }
}
