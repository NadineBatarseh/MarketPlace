import StoreListPage from './pages/storeList/StoreListPage';
import SearchResultsPage from './pages/search/SearchResultsPage';
import DeliveryAgentPage from './pages/delivery agent/DeliveryAgentPage';
import CollectorPage from './pages/delivery agent/CollectorPage';
import HubPage from './pages/delivery agent/HubPage';
import DelivererPage from './pages/delivery agent/DelivererPage';
import DriverDashboard from './pages/delivery agent/DriverDashboard';
import DriverRouteMap from './pages/delivery agent/DriverRouteMap';
import DeliveryRouteGuard from './components/DeliveryRouteGuard';
import OrderHistoryPage from './pages/orderHistory/OrderHistoryPage';
import OrderTrackingPage from './pages/orderTrackingPage/OrderTrackingPage';
import MetaConnectPage from './pages/MetaConnectPage';


const myShopId = 'cc76a171-a549-43c8-ad7c-7bcadbd0e9a3';
import { BrowserRouter, Routes, Route, Navigate, useParams } from "react-router-dom";
import "./App.css";
import StorePage from "./pages/singleStore/storePage";
import ProductsPage from "./ProductsPage";
import ProductDetailPage from "./pages/productDetails/ProductDetailPage";
import Cart from "./pages/Cart";
import Favorite from "./pages/Favorite";
import CheckoutPage from "./pages/checkout/CheckoutPage";
import Login from "./pages/auth/Login";
import CustomerSignup from "./pages/auth/CustomerSignup";
import MerchantApplication from "./pages/auth/MerchantApplication";
import DeliveryApplication from "./pages/auth/DeliveryApplication";
import HubWorkerApplication from "./pages/auth/HubWorkerApplication";
import Activate from "./pages/auth/Activate";
import { ShopProvider } from "./context/ShopContext";
import { CustomerAuthProvider } from "./context/CustomerAuthContext";
import { MerchantAuthProvider } from "./merchant-dashboard/context/MerchantAuthContext";
import { AuthProvider } from "./context/AuthContext";
import MerchantDashboard from "./merchant-dashboard/MerchantDashboard";
// @ts-ignore
import ChatBot from "./components/chatbot/ChatBot";
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


function StorePageWrapper() {
  const { shopId } = useParams<{ shopId: string }>();
  return <StorePage shopId={shopId!} />;
}

export default function App() {
  return (
    <AuthProvider>
    <MerchantAuthProvider>
      <CustomerAuthProvider>
        <ShopProviderWithAuth>
          <BrowserRouter>
            <ChatBot />
            <Routes>
              {/* Landing → stores listing */}
              <Route path="/" element={<Navigate to="/store" replace />} />
              <Route path="/store/:shopId" element={<StoreWrapper />} />
              <Route path="/cart" element={<Cart />} />
              <Route path="/checkout" element={<CheckoutPage />} />
              <Route path="/favorites" element={<Favorite />} />
              <Route path="/merchant-dashboard" element={<MerchantDashboard />} />
              <Route path="/admin-dashboard" element={<AdminDashboard />} />
              <Route path="/" element={<StorePage shopId={myShopId} />} />
              <Route path="/store" element={<StoreListPage />} />
              <Route path="/stores/:shopId" element={<StorePageWrapper />} />
              <Route path="/sync" element={<ProductsPage />} />
              <Route path="/product/:id" element={<ProductDetailPage />} />
              <Route path="/product" element={<ProductDetailPage />} />
              <Route path="/login" element={<Login />} />
              <Route path="/signup" element={<CustomerSignup />} />
              <Route path="/merchant-application" element={<MerchantApplication />} />
              <Route path="/delivery-application" element={<DeliveryApplication />} />
              <Route path="/hubworker-application" element={<HubWorkerApplication />} />
              <Route path="/activate" element={<Activate />} />
              <Route path="/driver-dashboard" element={<DeliveryRouteGuard><DriverDashboard /></DeliveryRouteGuard>} />
              <Route path="/driver-route" element={<DeliveryRouteGuard><DriverRouteMap /></DeliveryRouteGuard>} />
              <Route path="/delivery" element={<DeliveryAgentPage />} />
              <Route path="/collector" element={<CollectorPage />} />
              <Route path="/hub" element={<HubPage />} />
              <Route path="/c" element={<DelivererPage />} />
              <Route path="/search" element={<SearchResultsPage />} />
              <Route path="/orders" element={<OrderHistoryPage />} />
              <Route path="/orders/:orderId" element={<OrderTrackingPage />} />
              <Route path="/meta-connect" element={<MetaConnectPage />} />
            </Routes>
          </BrowserRouter>
        </ShopProviderWithAuth>
      </CustomerAuthProvider>
    </MerchantAuthProvider>
    </AuthProvider>
  );
}