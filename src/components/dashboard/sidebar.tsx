"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  ShoppingBag,
  Users,
  Package,
  MessageCircle,
  Settings,
  Bot,
  Menu,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { useDashboardBadges } from "@/components/dashboard/badges";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, badgeKey: "attention" as const },
  { href: "/orders", label: "Orders", icon: ShoppingBag, badgeKey: "orders" as const },
  { href: "/customers", label: "Customers", icon: Users, badgeKey: null },
  { href: "/products", label: "Products", icon: Package, badgeKey: null },
  { href: "/whatsapp", label: "WhatsApp Agent", icon: Bot, badgeKey: null },
  { href: "/ai", label: "AI Control", icon: Bot, badgeKey: null },
  { href: "/whatsapp/conversations", label: "Conversations", icon: MessageCircle, badgeKey: "chats" as const },
  { href: "/settings", label: "Settings", icon: Settings, badgeKey: null },
];

function Badge({ n }: { n: number }) {
  if (!n) return null;
  return (
    <span className="ml-auto inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
      {n > 99 ? "99+" : n}
    </span>
  );
}

export function Sidebar({ businessName }: { businessName: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const badges = useDashboardBadges(4000);

  function countFor(key: "attention" | "orders" | "chats" | null) {
    if (key === "orders") return badges.pendingOrders;
    if (key === "chats") return badges.attentionChats;
    if (key === "attention") return badges.unreadNotifications || badges.attentionChats;
    return 0;
  }

  return (
    <>
      <button
        className="fixed left-4 top-4 z-50 rounded-lg bg-white p-2 shadow-md lg:hidden"
        onClick={() => setOpen(!open)}
      >
        {open ? <X size={20} /> : <Menu size={20} />}
      </button>

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 w-64 transform border-r border-gray-200 bg-white transition-transform lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex h-full flex-col">
          <div className="border-b border-gray-200 p-6">
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-green-600">
                <MessageCircle className="h-5 w-5 text-white" />
              </div>
              <div>
                <p className="text-sm font-bold text-gray-900">OrderDesk</p>
                <p className="truncate text-xs text-gray-500">{businessName}</p>
              </div>
            </div>
          </div>

          <nav className="flex-1 space-y-1 p-4">
            {navItems.map(({ href, label, icon: Icon, badgeKey }) => {
              const active =
                href === "/whatsapp"
                  ? pathname === "/whatsapp"
                  : pathname === href || (href !== "/dashboard" && pathname.startsWith(href));
              return (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setOpen(false)}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                    active
                      ? "bg-green-50 text-green-700"
                      : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                  )}
                >
                  <Icon size={18} />
                  {label}
                  <Badge n={countFor(badgeKey)} />
                </Link>
              );
            })}
          </nav>

          <div className="border-t border-gray-200 p-4">
            <div className="rounded-lg bg-green-50 p-3">
              <div className="flex items-center gap-2">
                <Bot size={16} className="text-green-600" />
                <span className="text-xs font-medium text-green-700">AI Agent Active</span>
              </div>
              <p className="mt-1 text-xs text-green-600">Groq AI + dashboard catalog</p>
              {badges.attentionChats > 0 && (
                <p className="mt-2 text-xs font-semibold text-amber-700">
                  {badges.attentionChats} chat need you
                </p>
              )}
            </div>
          </div>
        </div>
      </aside>

      {open && (
        <div className="fixed inset-0 z-30 bg-black/20 lg:hidden" onClick={() => setOpen(false)} />
      )}
    </>
  );
}
