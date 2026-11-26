import { useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Landing } from '../pages/Landing';
import { Layout, RequireRole } from '../components/Layout';
import { Loading } from '../components/ui';
import { BILLING, MANAGE, PURCHASE, useAuth } from './auth';
import { Admin } from '../pages/Admin';
import { Billing } from '../pages/Billing';
import { ChangePassword } from '../pages/ChangePassword';
import { Dashboard } from '../pages/Dashboard';
import { Gst } from '../pages/Gst';
import { Login } from '../pages/Login';
import { Products } from '../pages/Products';
import { PurchaseEditor } from '../pages/PurchaseEditor';
import { Purchases } from '../pages/Purchases';
import { Reports } from '../pages/Reports';
import { SalesRegister } from '../pages/SalesRegister';
import { Stock } from '../pages/Stock';

export function App() {
  const { me, loading } = useAuth();
  // The showcase plays when the site is opened; after a logout the login screen comes straight back.
  const [entered, setEntered] = useState(false);
  if (loading) return <Loading label="Starting" />;
  if (!me) return entered ? <Login /> : <Landing onLogin={() => setEntered(true)} />;
  if (me.mustChangePassword) return <ChangePassword forced />;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="billing" element={<RequireRole roles={BILLING}><Billing /></RequireRole>} />
        <Route path="sales" element={<RequireRole roles={['ADMIN', 'MANAGER', 'CASHIER']}><SalesRegister /></RequireRole>} />
        <Route path="purchases" element={<RequireRole roles={PURCHASE}><Purchases /></RequireRole>} />
        <Route path="purchases/:id" element={<RequireRole roles={PURCHASE}><PurchaseEditor /></RequireRole>} />
        <Route path="products" element={<RequireRole roles={PURCHASE}><Products /></RequireRole>} />
        <Route path="stock" element={<RequireRole roles={PURCHASE}><Stock /></RequireRole>} />
        <Route path="reports" element={<Reports />} />
        <Route path="gst" element={<RequireRole roles={MANAGE}><Gst /></RequireRole>} />
        <Route path="admin" element={<RequireRole roles={MANAGE}><Admin /></RequireRole>} />
        <Route path="account" element={<ChangePassword />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
