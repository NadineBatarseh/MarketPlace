import { useEffect, useState } from "react";

const BACKEND_URL = "http://localhost:4000";

type Product = {
  id: string;
  shop_id: string;
  meta_product_id: string;
  title: string | null;
  description: string | null;
  price: number | null;
  image_url: string | null;
  stock_Quantity: number; // if you have it in DB
};

const CURRENT_SHOP_ID = "cc76a171-a549-43c8-ad7c-7bcadbd0e9a3";

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  // ✅ load products from DB
  async function fetchProducts() {
  const res = await fetch("/api/products");
  const data = await res.json();
  if (data.ok) setProducts(data.products);
}

async function syncFromMeta() {
  setLoading(true);
  setMsg("");

  const res = await fetch("/api/sync-products", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ shop_id: CURRENT_SHOP_ID }),
  });

  const data = await res.json();
  console.log("sync result:", data);

  if (!data.ok) {
    setMsg("Sync failed (check backend terminal).");
    setLoading(false);
    return;
  }

  setMsg(`Synced ✅ fetched=${data.productsFetched} saved=${data.savedToDb}`);
  await fetchProducts();
  setLoading(false);
}


  // ✅ Auto-load products when page opens
  useEffect(() => {
    fetchProducts();
  }, []);

  return (
    <div style={{ padding: 20 }}>
      <h2>Products</h2>

      <button onClick={syncFromMeta} disabled={loading}>
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
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                }}
              />
            ) : (
              <div
                style={{
                  width: 80,
                  height: 80,
                  background: "#eee",
                  borderRadius: 8,
                }}
              />
            )}

            <div>
              <div style={{ fontWeight: 700 }}>{p.title ?? "No name"}</div>

              <div style={{ fontSize: 13, opacity: 0.8, marginTop: 4 }}>
                {p.description ?? "No description"}
              </div>

              <div style={{ marginTop: 6 }}>
                {p.price != null ? `${p.price} ₪` : "Price not available"}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
