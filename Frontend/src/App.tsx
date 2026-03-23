import { BrowserRouter, Routes, Route, useNavigate } from "react-router-dom";
import ProductsPage from "./ProductsPage";
import ProductDetailPage from "./productDetail/ProductDetailPage";

function Home() {
  const navigate = useNavigate();

  const connectMeta = () => {
    window.location.href = "/auth/meta";
  };

  return (
    <div>
      <div style={{ padding: 20, display: "flex", gap: 10 }}>
        <button onClick={connectMeta}>
          Connect Meta (Permission)
        </button>

        <button onClick={() => navigate("/product")}>
          View Product Page
        </button>
      </div>

      <ProductsPage />
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/product" element={<ProductDetailPage />} />
        <Route path="/product/:id" element={<ProductDetailPage />} />
      </Routes>
    </BrowserRouter>
  );
}