import { Routes, Route, Navigate } from "react-router-dom";
import OwnerDashboard from "./pages/OwnerDashboard.jsx";
import LiveDisplay from "./pages/LiveDisplay.jsx";
import PublicView from "./pages/PublicView.jsx";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/owner" replace />} />
      <Route path="/owner" element={<OwnerDashboard />} />
      <Route path="/display" element={<LiveDisplay />} />
      <Route path="/salon/:salonId" element={<PublicView />} />
    </Routes>
  );
}
