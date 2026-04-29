import HomePage from './pages/home/HomePage';
import StoreListPage from './pages/storeList/StoreListPage';
import SearchResultsPage from './pages/search/SearchResultsPage';
import DeliveryAgentPage from './pages/delivery agent/DeliveryAgentPage';
import HubPage from './pages/delivery agent/HubPage';
import DelivererPage from './pages/delivery agent/DelivererPage';
import DriverDashboard from './pages/delivery agent/DriverDashboard';
import DriverRouteMap from './pages/delivery agent/DriverRouteMap';
import RoleGuard from './components/RoleGuard';
import OrderHistoryPage from './pages/orderHistory/OrderHistoryPage';
import OrderTrackingPage from './pages/orderTrackingPage/OrderTrackingPage';
import MetaConnectPage from './pages/MetaConnectPage';


import { BrowserRouter, Routes, Route, Navigate, useParams } from "react-router-dom";
import { useSharedAuth } from "./context/AuthContext";
import "./App.css";
import StorePage from "./pages/singleStore/storePage";
import ProductsPage from "./ProductsPage";
import ProductDetailPage from "./pages/productDetails/ProductDetailPage";
import Cart from "./pages/Cart";
import Favorite from "./pages/Favorite";
import CheckoutPage from "./pages/checkout/CheckoutPage";
import Login from "./pages/auth/Login";
import ForgotPassword from "./pages/auth/ForgotPassword";
import ResetPassword from "./pages/auth/ResetPassword";
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

const ROLE_HOME: Record<string, string> = {
  customer: '/store',
  merchant: '/merchant-dashboard',
  delivery: '/driver-dashboard',
  hubworker: '/hub',
  admin: '/admin-dashboard',
};

function RoleHomeRedirect() {
  const { rawUser, role, isLoading } = useSharedAuth();
  if (isLoading) return null;
  if (!rawUser) return <Navigate to="/store" replace />;
  return <Navigate to={ROLE_HOME[role ?? ''] ?? '/store'} replace />;
}

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
              {/* Landing → role-aware redirect */}
              <Route path="/" element={<RoleHomeRedirect />} />

              {/* Auth pages — always public */}
              <Route path="/login" element={<Login />} />
              <Route path="/forgot-password" element={<ForgotPassword />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/signup" element={<CustomerSignup />} />
              <Route path="/merchant-application" element={<MerchantApplication />} />
              <Route path="/delivery-application" element={<DeliveryApplication />} />
              <Route path="/hubworker-application" element={<HubWorkerApplication />} />
              <Route path="/activate" element={<Activate />} />
              <Route path="/sync" element={<ProductsPage />} />
              <Route path="/meta-connect" element={<MetaConnectPage />} />

              {/* Customer or guest browsing — other roles redirected to their home */}
              <Route path="/store" element={<RoleGuard allowedRoles={['customer']} allowGuests><HomePage /></RoleGuard>} />
              <Route path="/store/:shopId" element={<RoleGuard allowedRoles={['customer']} allowGuests><StoreWrapper /></RoleGuard>} />
              <Route path="/stores/:shopId" element={<RoleGuard allowedRoles={['customer']} allowGuests><StorePageWrapper /></RoleGuard>} />
              <Route path="/product/:id" element={<RoleGuard allowedRoles={['customer']} allowGuests><ProductDetailPage /></RoleGuard>} />
              <Route path="/product" element={<RoleGuard allowedRoles={['customer']} allowGuests><ProductDetailPage /></RoleGuard>} />
              <Route path="/search" element={<RoleGuard allowedRoles={['customer']} allowGuests><SearchResultsPage /></RoleGuard>} />

              {/* Customer only */}
              <Route path="/cart" element={<RoleGuard allowedRoles={['customer']} allowGuests><Cart /></RoleGuard>} />
              <Route path="/checkout" element={<RoleGuard allowedRoles={['customer']} allowGuests><CheckoutPage /></RoleGuard>} />
              <Route path="/favorites" element={<RoleGuard allowedRoles={['customer']} allowGuests><Favorite /></RoleGuard>} />
              <Route path="/orders" element={<RoleGuard allowedRoles={['customer']} allowGuests><OrderHistoryPage /></RoleGuard>} />
              <Route path="/orders/:orderId" element={<RoleGuard allowedRoles={['customer']} allowGuests><OrderTrackingPage /></RoleGuard>} />

              {/* Merchant only */}
              <Route path="/merchant-dashboard" element={<RoleGuard allowedRoles={['merchant']}><MerchantDashboard /></RoleGuard>} />

              {/* Admin only */}
              <Route path="/admin-dashboard" element={<RoleGuard allowedRoles={['admin']}><AdminDashboard /></RoleGuard>} />

              {/* Delivery only */}
              <Route path="/driver-dashboard" element={<RoleGuard allowedRoles={['delivery']}><DriverDashboard /></RoleGuard>} />
              <Route path="/driver-route" element={<RoleGuard allowedRoles={['delivery']}><DriverRouteMap /></RoleGuard>} />
              <Route path="/delivery" element={<RoleGuard allowedRoles={['delivery']}><DeliveryAgentPage /></RoleGuard>} />
              <Route path="/c" element={<RoleGuard allowedRoles={['delivery']}><DelivererPage /></RoleGuard>} />

              {/* Delivery or Hub worker */}
             // <Route path="/hub" element={<RoleGuard allowedRoles={['delivery', 'hubworker']}><HubPage /></RoleGuard>} />
            </Routes>
          </BrowserRouter>
        </ShopProviderWithAuth>
      </CustomerAuthProvider>
    </MerchantAuthProvider>
    </AuthProvider>
  );
}