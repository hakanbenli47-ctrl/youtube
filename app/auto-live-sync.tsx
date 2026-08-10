"use client";

import { useEffect, useRef } from "react";

const LIVE_INTERVAL_MS = 2 * 60_000;
const IDLE_BEFORE_REFRESH_MS = 8_000;

export default function AutoLiveSync() {
  const lastInteraction = useRef(Date.now());
  const running = useRef(false);
  const pendingRefresh = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const markInteraction = () => {
      lastInteraction.current = Date.now();
    };

    const events: Array<keyof WindowEventMap> = ["pointerdown", "keydown", "touchstart", "scroll"];
    events.forEach((event) => window.addEventListener(event, markInteraction, { passive: true }));

    const refreshWhenSafe = () => {
      if (window.location.pathname !== "/") return;
      if (document.hidden) return;
      const detailOpen = Boolean(document.querySelector(".detail-backdrop"));
      const idleFor = Date.now() - lastInteraction.current;
      if (!detailOpen && idleFor >= IDLE_BEFORE_REFRESH_MS) {
        window.location.reload();
        return;
      }
      if (pendingRefresh.current) clearTimeout(pendingRefresh.current);
      pendingRefresh.current = setTimeout(refreshWhenSafe, 10_000);
    };

    const sync = async () => {
      if (running.current || document.hidden) return;
      running.current = true;
      try {
        const response = await fetch("/api/sync?auto=1", {
          method: "POST",
          cache: "no-store",
        });
        if (response.ok) {
          await response.json().catch(() => null);
          refreshWhenSafe();
        }
      } catch {
        // Geçici ağ hatasında mevcut ekran korunur; sonraki 2 dakikalık tur tekrar dener.
      } finally {
        running.current = false;
      }
    };

    const interval = window.setInterval(() => void sync(), LIVE_INTERVAL_MS);
    return () => {
      window.clearInterval(interval);
      if (pendingRefresh.current) clearTimeout(pendingRefresh.current);
      events.forEach((event) => window.removeEventListener(event, markInteraction));
    };
  }, []);

  return null;
}
