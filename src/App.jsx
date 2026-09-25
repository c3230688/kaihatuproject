import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";

import AppShell from "./components/AppShell.jsx";
import RequireAuth from "./components/RequireAuth.jsx";
import LoginForm from "./pages/LoginForm.jsx";

import Planner from "./pages/Planner.jsx";
import Reschedule from "./pages/Reschedule.jsx";
import Footprints from "./pages/Footprints.jsx";
import Mypage from "./pages/Mypage.jsx";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginForm />} />

      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route path="/" element={<Planner />} />
          <Route path="/reschedule" element={<Reschedule />} />
          <Route path="/footprints" element={<Footprints />} />
          <Route path="/mypage" element={<Mypage />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
