import './StoreNav.css';

export default function StoreNav() {
  return (
    <nav className="nav">
      <a href="/" className="active">الصفحة الرئيسية</a>
      <a href="/store">المتاجر</a>
      <a href="#">الجديد</a>
      <a href="#">عروض</a>
    </nav>
  );
}
