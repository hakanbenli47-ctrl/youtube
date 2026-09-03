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

export default function UiMessageTranslator() {
  useEffect(() => {
    translateNotices();
    const observer = new MutationObserver(() => translateNotices());
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    return () => observer.disconnect();
  }, []);

  return null;
}
