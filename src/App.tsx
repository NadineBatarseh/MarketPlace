import HomePage from './pages/home/HomePage';
import CategoryListingPage from './pages/categoryListing/CategoryListingPage';
import StoreListPage from './pages/storeList/StoreListPage';
import SearchResultsPage from './pages/search/SearchResultsPage';
import DeliveryAgentPage from './pages/delivery agent/DeliveryAgentPage';
import HubPage from './pages/delivery agent/HubPage';
import DelivererPage from './pages/delivery agent/DelivererPage';
import DriverDashboard from './pages/delivery agent/DriverDashboard';
import DriverRouteMap from './pages/delivery agent/DriverRouteMap';
import DriverInboxPage from './pages/delivery agent/DriverInboxPage';
import RoleGuard from './components/RoleGuard';
import OrderHistoryPage from './pages/orderHistory/OrderHistoryPage';
import OrderTrackingPage from './pages/orderTrackingPage/OrderTrackingPage';
import MetaConnectPage from './pages/MetaConnectPage';
import PrivacyPolicyPage from './pages/privacy/PrivacyPolicyPage';
import PaytabsReturnPage from './pages/payment/PaytabsReturnPage';
import ProfileSettingsPage from './pages/profile/ProfileSettingsPage';


import { BrowserRouter, Routes, Route, Navigate, useParams } from "react-router-dom";
import TopLoadingBar from "./components/TopLoadingBar";
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
import Footer from "./components/Footer";
import { useMerchantAuth } from './merchant-dashboard/context/MerchantAuthContext';
import { useCustomerAuth } from './context/CustomerAuthContext';


function CustomerLayout({ children }: { children: React.ReactNode }) {
  return <>{children}<Footer /></>;
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

function RootRedirect() {
  return <CustomerLayout><HomePage /></CustomerLayout>;
}

export default function App() {
  return (
    <AuthProvider>
    <MerchantAuthProvider>
      <CustomerAuthProvider>
        <ShopProviderWithAuth>
          <BrowserRouter>
            <TopLoadingBar />
            <ChatBot />
            <Routes>
              {/* Landing → redirect to role home */}
              <Route path="/" element={<RootRedirect />} />

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
              <Route path="/privacy-policy" element={<PrivacyPolicyPage />} />

              {/* Customer or guest browsing — other roles redirected to their home */}
              <Route path="/home" element={<RoleGuard allowedRoles={['customer']} allowGuests><CustomerLayout><HomePage /></CustomerLayout></RoleGuard>} />
              <Route path="/store" element={<Navigate to="/home" replace />} />
              <Route path="/stores-list" element={<RoleGuard allowedRoles={['customer']} allowGuests><CustomerLayout><StoreListPage /></CustomerLayout></RoleGuard>} />
              <Route path="/store/:shopId" element={<RoleGuard allowedRoles={['customer']} allowGuests><CustomerLayout><StoreWrapper /></CustomerLayout></RoleGuard>} />
              <Route path="/stores/:shopId" element={<RoleGuard allowedRoles={['customer']} allowGuests><CustomerLayout><StorePageWrapper /></CustomerLayout></RoleGuard>} />
              <Route path="/product/:id" element={<RoleGuard allowedRoles={['customer']} allowGuests><CustomerLayout><ProductDetailPage /></CustomerLayout></RoleGuard>} />
              <Route path="/product" element={<RoleGuard allowedRoles={['customer']} allowGuests><CustomerLayout><ProductDetailPage /></CustomerLayout></RoleGuard>} />
              <Route path="/search" element={<RoleGuard allowedRoles={['customer']} allowGuests><CustomerLayout><SearchResultsPage /></CustomerLayout></RoleGuard>} />
              <Route path="/category/:categoryId" element={<RoleGuard allowedRoles={['customer']} allowGuests><CustomerLayout><CategoryListingPage /></CustomerLayout></RoleGuard>} />

              {/* Customer only — no guests, no other roles */}
              <Route path="/cart" element={<RoleGuard allowedRoles={['customer']}><CustomerLayout><Cart /></CustomerLayout></RoleGuard>} />
              <Route path="/checkout" element={<RoleGuard allowedRoles={['customer']}><CustomerLayout><CheckoutPage /></CustomerLayout></RoleGuard>} />
              <Route path="/favorites" element={<RoleGuard allowedRoles={['customer']}><CustomerLayout><Favorite /></CustomerLayout></RoleGuard>} />
              <Route path="/profile" element={<RoleGuard allowedRoles={['customer']}><CustomerLayout><ProfileSettingsPage /></CustomerLayout></RoleGuard>} />
              <Route path="/orders" element={<RoleGuard allowedRoles={['customer']}><CustomerLayout><OrderHistoryPage /></CustomerLayout></RoleGuard>} />
              <Route path="/orders/:orderId" element={<RoleGuard allowedRoles={['customer']}><CustomerLayout><OrderTrackingPage /></CustomerLayout></RoleGuard>} />
              <Route path="/payment/paytabs/return" element={<RoleGuard allowedRoles={['customer']}><CustomerLayout><PaytabsReturnPage /></CustomerLayout></RoleGuard>} />

              {/* Merchant only */}
              <Route path="/merchant-dashboard" element={<RoleGuard allowedRoles={['merchant']}><MerchantDashboard /></RoleGuard>} />

              {/* Admin only */}
              <Route path="/admin-dashboard" element={<RoleGuard allowedRoles={['admin']}><AdminDashboard /></RoleGuard>} />

              {/* Delivery only */}
              <Route path="/driver-dashboard" element={<RoleGuard allowedRoles={['delivery']}><DriverDashboard /></RoleGuard>} />
              <Route path="/driver-route" element={<RoleGuard allowedRoles={['delivery']}><DriverRouteMap /></RoleGuard>} />
              <Route path="/driver-inbox" element={<RoleGuard allowedRoles={['delivery']}><DriverInboxPage /></RoleGuard>} />
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