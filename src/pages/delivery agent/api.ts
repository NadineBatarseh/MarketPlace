export interface DelivererOrder {
  id: number;
  status: string;
  total_price: number | null;
  delivery_lat: number;
  delivery_lng: number;
  customer_email: string | null;
  hub: { name: string } | null;
}
