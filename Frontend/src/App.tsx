import ProductsPage from "./ProductsPage";

export default function App() {

  const connectMeta = () => {
    // This should call YOUR FRIEND'S backend auth route
    window.location.href = "/auth/meta";
  };

  return (
    <div>
      <div style={{ padding: 20 }}>
        <button onClick={connectMeta}>
          Connect Meta (Permission)
        </button>
      </div>

      <ProductsPage />
    </div>
  );
}
