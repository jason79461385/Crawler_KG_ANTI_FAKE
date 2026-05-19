import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router-dom";
import { Layout } from "./components/Layout";
import { SnapshotProvider } from "./context/SnapshotContext";
import { DashboardPage } from "./pages/DashboardPage";
import { CasesPage } from "./pages/CasesPage";
import { VerifyPage } from "./pages/VerifyPage";
import { GraphPage } from "./pages/GraphPage";
import { ReportPage } from "./pages/ReportPage";
import "./styles.css";

const router = createBrowserRouter([
  {
    path: "/",
    element: <Layout />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: "cases", element: <CasesPage /> },
      { path: "verify", element: <VerifyPage /> },
      { path: "graph", element: <GraphPage /> },
      { path: "report", element: <ReportPage /> },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <SnapshotProvider>
      <RouterProvider router={router} />
    </SnapshotProvider>
  </React.StrictMode>,
);
