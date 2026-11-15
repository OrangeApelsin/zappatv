import { useLocale } from "../hooks/useLocale";
import type { LibraryLoadState } from "../stores/library";
export function BrowseStatus({
  state,
  stale = false,
  focused = false,
  onRetry,
  emptyText,
  loadingText,
}: {
  state: LibraryLoadState;
  stale?: boolean;
  focused?: boolean;
  onRetry: () => void;
  emptyText?: string;
  loadingText?: string;
}) {
  const { t } = useLocale();
  if (state === "loaded") return null;
  return (
    <div className={`browse-status ${stale ? "stale" : ""}`} role="status" aria-live="polite">
      <span>
        {state === "loading"
          ? (loadingText ?? t("library.loading"))
          : state === "failed"
            ? t(stale ? "library.stale" : "library.failed")
            : (emptyText ?? t("channel.nothingInCategory"))}
      </span>
      {state === "failed" && (
        <button type="button" className={focused ? "focused" : ""} onClick={onRetry}>
          {t("library.retry")}
        </button>
      )}
    </div>
  );
}
