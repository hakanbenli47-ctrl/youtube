"use client";

import { useEffect, useRef } from "react";
import type { DashboardData } from "@/lib/schema";

const LIVE_INTERVAL_MS = 2 * 60_000;

export default function AutoLiveSync() {
  const running = useRef(false);

  useEffect(() => {
    const sync = async () => {
      if (running.current || document.hidden) return;
      running.current = true;
      try {
        const response = await fetch("/api/sync?auto=1", {
          method: "POST",
          cache: "no-store",
        });
        const payload = await response.json().catch(() => null) as {
          dashboard?: DashboardData;
        } | null;

        if (response.ok && payload?.dashboard) {
          window.dispatchEvent(new CustomEvent<DashboardData>("youtube-dashboard-update", {
            detail: payload.dashboard,
          }));
        }
      } catch {
        // Geçici ağ hatasında ekran korunur; sonraki iki dakikalık tur tekrar dener.
      } finally {
        running.current = false;
      }
    };

    const interval = window.setInterval(() => void sync(), LIVE_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, []);

  return null;
}
