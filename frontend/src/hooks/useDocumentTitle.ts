/**
 * Per-page browser-tab titles. Every tab used to read "ReadyRoute V2"
 * verbatim from index.html — indistinguishable when a supervisor keeps the
 * board, the report and trends open at once. PageHeader calls this with its
 * title, so most pages get it for free; pages without a header call it
 * directly.
 */
import { useEffect } from "react";

const APP_NAME = "ReadyRoute";

export function useDocumentTitle(title?: string | null) {
  useEffect(() => {
    if (!title) return;
    const prev = document.title;
    document.title = `${title} — ${APP_NAME}`;
    return () => {
      document.title = prev;
    };
  }, [title]);
}
