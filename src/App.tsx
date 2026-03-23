import { BrowserRouter, Routes, Route, Navigate, useParams } from "react-router-dom";
import "./App.css";
import StorePage from "./pages/singleStore/storePage";
import ProductsPage from "./ProductsPage";
import ProductDetailPage from "./pages/productDetails/ProductDetailPage";
import Cart from "./pages/Cart";
import Favorite from "./pages/Favorite";
import StoresPage from "./pages/StoresPage";
import { ShopProvider } from "./context/ShopContext";
import { CustomerAuthProvider } from "./context/CustomerAuthContext";
import { MerchantAuthProvider } from "./merchant-dashboard/context/MerchantAuthContext";
import MerchantDashboard from "./merchant-dashboard/MerchantDashboard";
import AdminDashboard from "./merchant-dashboard/pages/AdminDashboard";
import { useMerchantAuth } from './merchant-dashboard/context/MerchantAuthContext';
import { useCustomerAuth } from './context/CustomerAuthContext';

function StoreWrapper() {
  const { shopId } = useParams<{ shopId: string }>();
  if (!shopId) return <div className="app-missing-shop">معرّف المتجر مفقود</div>;
  return <StorePage shopId={shopId} />;
}
function ShopProviderWithAuth({ children }: { children: React.ReactNode }) {
  const { merchant } = useMerchantAuth();
  const { customer } = useCustomerAuth();
  const userId = merchant?.id ?? customer?.id ?? undefined;
  return <ShopProvider userId={userId}>{children}</ShopProvider>;
}


export default function App() {
  return (
    <MerchantAuthProvider>
      <CustomerAuthProvider>
        <ShopProviderWithAuth>
          <BrowserRouter>
            <Routes>
              {/* Landing → stores listing */}
              <Route path="/" element={<Navigate to="/store" replace />} />
              <Route path="/store" element={<StoresPage />} />
              <Route path="/store/:shopId" element={<StoreWrapper />} />
              <Route path="/sync" element={<ProductsPage />} />
              <Route path="/product" element={<ProductDetailPage />} />
              <Route path="/product/:id" element={<ProductDetailPage />} />
              <Route path="/cart" element={<Cart />} />
              <Route path="/favorites" element={<Favorite />} />
              <Route path="/merchant-dashboard" element={<MerchantDashboard />} />
              <Route path="/admin-dashboard" element={<AdminDashboard />} />
            </Routes>
          </BrowserRouter>
        </ShopProviderWithAuth>
      </CustomerAuthProvider>
    </MerchantAuthProvider>
  );
}
