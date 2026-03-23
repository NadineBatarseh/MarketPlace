export interface Store {
  shop_id: string;
  name: string;
  description: string | null;
  shopLogo: string | null;
  created_at: string;
  whatsapp: string | null;
  instagram: string | null;
  facebook: string | null;
  location: string | null;
  avg_rating: number | null;
  review_count: number;
}

export interface Product {
  id: string;
  title: string;
  description: string | null;
  price: number | null;
  image_url: string | string[] | null;
  stock_Quantity: number | null;
}
