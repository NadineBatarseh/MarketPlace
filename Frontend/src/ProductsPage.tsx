import { useEffect, useState } from "react";

type Product = {
  id: string;
  meta_product_id: string;
  retailer_id: string | null;
  name: string | null;
  price: string | null;
  availability: string | null;
  image_url: string | null;
};

const BACKEND_URL = "http://localhost:4000";

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
      setMsg("Sync failed (check backend terminal).");
      setLoading(false);
      return;
    }

    setMsg(`Synced ✅ fetched=${data.productsFetched} saved=${data.savedToDb}`);
    await loadProducts();
    setLoading(false);
  }

  // Auto-load products when page opens (so you can SEE them even without clicking)
  // useEffect(() => {
  //   loadProducts();
  // }, []);

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
                alt={p.name ?? "product"}
                width={80}
                height={80}
                style={{ objectFit: "cover", borderRadius: 8 }}
              />
            ) : (
              <div style={{ width: 80, height: 80, background: "#eee", borderRadius: 8 }} />
            )}

            <div>
              <div style={{ fontWeight: 700 }}>{p.name ?? "No name"}</div>
              <div>{p.price ?? ""}</div>
              <div style={{ fontSize: 12, opacity: 0.7 }}>{p.availability ?? ""}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
