export const PAGE_SIZE = 12;

export type Status = "loading" | "success" | "error";

export interface Store {
  shop_id: string;
  name: string;
  description?: string;
  shopLogo?: string | null;
  created_at?: string;
  rating?: number;
  review_count?: number;
  followers_count?: number;
  product_count?: number;
  is_verified?: boolean;
  member_since?: number | string;
  whatsapp?: string | null;
  instagram?: string | null;
  facebook?: string | null;
  location?: string | null;
}

export interface Product {
  id: string | number;
  title?: string;
  name?: string;
  price?: string | number | null;
  old_price?: string | number | null;
  image_url?: string | null;
  rating?: number;
  review_count?: number;
  badge?: string;
  is_new?: boolean;
}
