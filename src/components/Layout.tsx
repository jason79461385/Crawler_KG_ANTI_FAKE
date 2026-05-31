import { NavLink, Outlet } from "react-router-dom";
import {
  DatabaseZap,
  Flag,
  Globe,
  LayoutDashboard,
  Network,
  RefreshCw,
  ScrollText,
  ShieldAlert,
} from "lucide-react";
import { useSnapshot } from "../context/SnapshotContext";
import { ChatWidget } from "./ChatWidget";
import { CrawlToast } from "./CrawlToast";

const NAV_LINKS = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/cases", label: "案例列表", icon: ScrollText },
  { to: "/verify", label: "網站驗證", icon: Globe },
  { to: "/graph", label: "知識圖譜", icon: Network },
  { to: "/report", label: "回報案例", icon: Flag },
];

export function Layout() {
  const { snapshot, refreshing, triggerCrawl } = useSnapshot();

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,#25334d_0%,#15233a_40%,#0f1b2e_100%)] text-white">
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#0f1b2e]/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-4 px-5 py-4 sm:px-8">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1.5 text-xs font-semibold tracking-[0.18em] text-cyan-200 uppercase">
              <ShieldAlert className="h-4 w-4" />
              Scam Intel
            </span>
            <span className="text-sm text-slate-300/85">
              {snapshot?.stats.posts ?? 0} 案例 · {snapshot?.stats.nodes ?? 0} KG 節點 · Graph: {snapshot?.graphStore.provider ?? "memory"}
            </span>
          </div>
          <nav className="flex flex-wrap gap-1.5 text-sm">
            {NAV_LINKS.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.end}
                className={({ isActive }) =>
                  `inline-flex items-center gap-2 rounded-full px-3.5 py-2 font-semibold transition ${
                    isActive
                      ? "border border-cyan-300/35 bg-cyan-400/15 text-cyan-100"
                      : "border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
                  }`
                }
              >
                <link.icon className="h-4 w-4" />
                {link.label}
              </NavLink>
            ))}
            <button
              type="button"
              onClick={() => void triggerCrawl()}
              disabled={refreshing}
              className="inline-flex items-center gap-2 rounded-full border border-cyan-300/25 bg-cyan-400/10 px-3.5 py-2 font-semibold text-cyan-100 transition hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
              {refreshing ? "同步中" : "重新同步"}
            </button>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-[1280px] px-5 py-8 sm:px-8 lg:px-10">
        <Outlet />
      </main>

      <footer className="border-t border-white/8 px-5 py-6 text-center text-xs text-slate-400/80">
        <span className="inline-flex items-center gap-1.5">
          <DatabaseZap className="h-3.5 w-3.5" />
          Scam Intel Console · prototype demo · 不構成正式法律或資安建議
        </span>
      </footer>

      <ChatWidget />
      <CrawlToast />
    </div>
  );
}
