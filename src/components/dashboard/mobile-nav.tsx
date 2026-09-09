"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, ShoppingBag, Package, MessageCircle, Bot } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDashboardBadges } from "@/components/dashboard/badges";

const items = [
  { href: "/dashboard", label: "Home", icon: LayoutDashboard, key: "attention" as const },
  { href: "/orders", label: "Orders", icon: ShoppingBag, key: "orders" as const },
  { href: "/products", label: "Products", icon: Package, key: null },
  { href: "/whatsapp/conversations", label: "Chats", icon: MessageCircle, key: "chats" as const },
  { href: "/whatsapp", label: "Agent", icon: Bot, key: null },
];

export function MobileNav() {
  const pathname = usePathname();
  const badges = useDashboardBadges(4000);

  function count(key: "attention" | "orders" | "chats" | null) {
    if (key === "orders") return badges.pendingOrders;
    if (key === "chats") return badges.attentionChats;
    if (key === "attention") return badges.unreadNotifications || badges.attentionChats;
    return 0;
  }

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-gray-200 bg-white px-2 py-2 lg:hidden">
      <div className="grid grid-cols-5 gap-1">
        {items.map(({ href, label, icon: Icon, key }) => {
          const active = pathname === href || (href !== "/dashboard" && pathname.startsWith(href));
          const n = count(key);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "relative flex flex-col items-center gap-1 rounded-lg py-1 text-[11px]",
                active ? "text-green-700" : "text-gray-500"
              )}
            >
              <Icon size={18} />
              {label}
              {n > 0 && (
                <span className="absolute right-2 top-0 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[9px] font-bold text-white">
                  {n > 9 ? "9+" : n}
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
