"use client";

import { useEffect } from "react";
import { turkishUiMessage } from "@/lib/ui-errors";

function translateNotices() {
  document.querySelectorAll<HTMLElement>(".notice").forEach((notice) => {
    for (const node of Array.from(notice.childNodes)) {
      if (node.nodeType !== Node.TEXT_NODE) continue;
      const original = node.textContent || "";
      const translated = turkishUiMessage(original, original);
      if (translated !== original) node.textContent = translated;
    }
  });
}

function repairScheduleHours() {
  document.querySelectorAll<HTMLElement>(".schedule-day > div").forEach((row) => {
    const seen = new Set<string>();
    let kept = 0;
    for (const item of Array.from(row.querySelectorAll<HTMLElement>(":scope > span"))) {
      const time = item.querySelector("b")?.textContent?.trim() || "";
      if (!time || seen.has(time) || kept >= 4) {
        item.remove();
        continue;
      }
      seen.add(time);
      kept += 1;
    }
  });
}

function repairUi() {
  translateNotices();
  repairScheduleHours();
}

export default function UiMessageTranslator() {
  useEffect(() => {
    repairUi();
    const observer = new MutationObserver(() => repairUi());
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    return () => observer.disconnect();
  }, []);

  return null;
}
