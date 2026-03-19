import { BrowserRouter, Routes, Route, useParams } from 'react-router-dom';
import StorePage from './pages/singleStore/storePage';
import StoreListPage from './pages/storeList/StoreListPage';
import ProductDetailPage from './pages/productDetails/ProductDetailPage';
import ProductsPage from './ProductsPage';
import DeliveryAgentPage from './pages/delivery agent/DeliveryAgentPage';
import CollectorPage from './pages/delivery agent/CollectorPage';
import HubPage from './pages/delivery agent/HubPage';
import DelivererPage from './pages/delivery agent/DelivererPage';

const myShopId = 'cc76a171-a549-43c8-ad7c-7bcadbd0e9a3';

function StorePageWrapper() {
  const { shopId } = useParams<{ shopId: string }>();
  return <StorePage shopId={shopId!} />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<StorePage shopId={myShopId} />} />
        <Route path="/stores" element={<StoreListPage />} />
        <Route path="/stores/:shopId" element={<StorePageWrapper />} />
        <Route path="/sync" element={<ProductsPage />} />
        <Route path="/product/:id" element={<ProductDetailPage />} />
        <Route path="/product" element={<ProductDetailPage />} />
        <Route path="/delivery" element={<DeliveryAgentPage />} />
        <Route path="/collector" element={<CollectorPage />} />
        <Route path="/hub" element={<HubPage />} />
        <Route path="/deliverer" element={<DelivererPage />} />
      </Routes>
    </BrowserRouter>
  );
}
