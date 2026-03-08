import { BrowserRouter, Routes, Route } from "react-router-dom";
import StorePage from "./pages/singleStore/storePage";
import ProductsPage from "./ProductsPage";
import ProductDetailPage from "./pages/productDetails/ProductDetailPage";
import MetaConnectPage from "./pages/MetaConnectPage";

const MY_SHOP_ID = "cc76a171-a549-43c8-ad7c-7bcadbd0e9a3";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/"
          element={<MetaConnectPage onConnected={() => { window.location.href = "/store"; }} />}
        />
        <Route path="/store" element={<StorePage shopId={MY_SHOP_ID} />} />
        <Route path="/sync" element={<ProductsPage />} />
        <Route path="/product" element={<ProductDetailPage />} />
        <Route path="/product/:id" element={<ProductDetailPage />} />
      </Routes>
    </BrowserRouter>
  );
}
