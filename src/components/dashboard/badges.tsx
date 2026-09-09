"use client";

import { useEffect, useRef, useState } from "react";

type Badges = {
  pendingOrders: number;
  newOrdersToday: number;
  attentionChats: number;
  unreadNotifications: number;
  latest: { title: string; message: string; type: string; at: string } | null;
};

export function useDashboardBadges(pollMs = 5000) {
  const [badges, setBadges] = useState<Badges>({
    pendingOrders: 0,
    newOrdersToday: 0,
    attentionChats: 0,
    unreadNotifications: 0,
    latest: null,
  });
  const prev = useRef<string>("");

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const res = await fetch("/api/dashboard/badges", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as Badges;
        if (!alive) return;
        setBadges(data);
        const sig = `${data.attentionChats}|${data.pendingOrders}|${data.latest?.at || ""}`;
        if (prev.current && prev.current !== sig && data.latest) {
          maybeNotify(data);
        }
        prev.current = sig;
      } catch {
        /* ignore */
      }
    }
    load();
    const id = window.setInterval(load, pollMs);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [pollMs]);

  return badges;
}

function maybeNotify(data: Badges) {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  const title =
    data.latest?.type === "order"
      ? "New order"
      : data.attentionChats > 0
        ? "Needs your attention"
        : data.latest?.title || "OrderDesk";
  const body = data.latest?.message || `${data.attentionChats} chat(s) need you`;

  const show = () => {
    try {
      new Notification(title, { body, tag: "orderdesk-attention" });
    } catch {
      /* ignore */
    }
  };

  if (Notification.permission === "granted") show();
  else if (Notification.permission !== "denied") {
    Notification.requestPermission().then((p) => {
      if (p === "granted") show();
    });
  }
}

export function DesktopNotifyGate() {
  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission === "default") {
      Notification.requestPermission().catch(() => undefined);
    }
  }, []);
  return null;
}
