import React from "react";
import { BrowserRouter, Routes, Route, useNavigate } from "react-router-dom";
import StorePage from "./pages/singleStore/storePage";
import ProductsPage from "./ProductsPage";
import ProductDetailPage from "./pages/productDetail/ProductDetailPage";

const MY_SHOP_ID = "cc76a171-a549-43c8-ad7c-7bcadbd0e9a3";

function Home() {
  const navigate = useNavigate();

  const connectMeta = () => {
    window.location.href = "/auth/meta";
  };

  return (
    <div>
      <div style={{ padding: 20, display: "flex", gap: 10 }}>
        <button type="button" onClick={connectMeta}>Connect Meta (Permission)</button>
        <button type="button" onClick={() => navigate("/product")}>View Product Page</button>
        <button type="button" onClick={() => navigate("/store")}>View Store Page</button>
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
        <Route path="/store" element={<StorePage shopId={MY_SHOP_ID} />} />
      </Routes>
    </BrowserRouter>
  );
}
