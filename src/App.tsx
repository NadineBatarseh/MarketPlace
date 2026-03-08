import { BrowserRouter, Routes, Route } from 'react-router-dom';
import StorePage from './pages/singleStore/storePage';
import ProductDetailPage from './pages/productDetails/ProductDetailPage';
import ProductsPage from './ProductsPage';
const myShopId = 'cc76a171-a549-43c8-ad7c-7bcadbd0e9a3';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<StorePage shopId={myShopId} />} />
        <Route path="/sync" element={<ProductsPage />} />
        <Route path="/product/:id" element={<ProductDetailPage />} />
        <Route path="/product" element={<ProductDetailPage />} />
      </Routes>
    </BrowserRouter>
  );
}
