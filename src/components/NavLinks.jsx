import React from "react";
import { LayoutDashboard, Briefcase, FileText, Settings, Users } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useI18n } from "@/lib/i18n/I18nContext";

const ITEMS = [
  { to: "/dashboard", icon: LayoutDashboard, key: "nav.dashboard" },
  { to: "/clients", icon: Users, key: "nav.clients" },
  { to: "/quotations", icon: FileText, key: "nav.quotations" },
  { to: "/jobs", icon: Briefcase, key: "nav.jobs" },
  { to: "/settings", icon: Settings, key: "nav.settings" },
];

export default function NavLinks({ onNavigate }) {
  const { t } = useI18n();

  return (
    <nav className="flex flex-col gap-1">
      {ITEMS.map((item) => (
        <Link
          key={item.to}
          to={item.to}
          onClick={onNavigate}
          className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          activeProps={{ className: "bg-sidebar-accent text-sidebar-accent-foreground" }}
        >
          <item.icon className="h-4 w-4" />
          {t(item.key)}
        </Link>
      ))}
    </nav>
  );
}