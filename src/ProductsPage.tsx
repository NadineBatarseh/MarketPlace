import { useEffect, useState } from "react";

type Product = {
  id: string;
  shop_id: string | null;
  meta_product_id: string;
  title: string | null;
  description: string | null;
  price: string | null;
  image_url: string | null;
  stock_Quantity: number | null;
};

// Empty string = relative path, works on any port (dev proxy or production)
const BACKEND_URL = "";

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  async function loadProducts() {
    const res = await fetch(`${BACKEND_URL}/products`);
    const data = await res.json();
    if (data.ok) setProducts(data.products);
  }

  async function sync() {
    setLoading(true);
    setMsg("");

    const res = await fetch(`${BACKEND_URL}/sync-products`, { method: "POST" });
    const data = await res.json();

    if (!data.ok) {
      setMsg(`Sync failed: ${data.error ?? "unknown error"}`);
      setLoading(false);
      return;
    }

    setMsg(`Synced ✅ fetched=${data.productsFetched} saved=${data.savedToDb}`);
    await loadProducts();
    setLoading(false);
  }

  useEffect(() => {
    loadProducts();
  }, []);

  return (
    <div style={{ padding: 20 }}>
      <h2>Products</h2>

      <button onClick={sync} disabled={loading}>
        {loading ? "Syncing..." : "Sync from Meta"}
      </button>

      {msg && <p>{msg}</p>}

      <div style={{ marginTop: 20, display: "grid", gap: 12 }}>
        {products.map((p) => (
          <div
            key={p.id}
            style={{
              border: "1px solid #ddd",
              borderRadius: 8,
              padding: 12,
              display: "flex",
              gap: 12,
              alignItems: "center",
            }}
          >
            {p.image_url ? (
              <img
                src={p.image_url}
                alt={p.title ?? "product"}
                width={80}
                height={80}
                style={{ objectFit: "cover", borderRadius: 8 }}
                onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
              />
            ) : (
              <div style={{ width: 80, height: 80, background: "#eee", borderRadius: 8 }} />
            )}

            <div>
              <div style={{ fontWeight: 700 }}>{p.title ?? "No title"}</div>
              <div>{p.price ?? ""}</div>
              <div style={{ fontSize: 12, opacity: 0.7 }}>{p.description ?? ""}</div>
              <div style={{ fontSize: 12 }}>Stock: {p.stock_Quantity ?? "N/A"}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
