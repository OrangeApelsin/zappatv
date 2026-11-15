import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocale } from "../hooks/useLocale";
import { KEY, useRemote } from "../hooks/useRemote";
import { useLibrary } from "../stores/library";
import { usePersonal } from "../stores/personal";
import type { ShapedVodItem } from "../workers/vodWorker";
import { type FiniteSelection, MediaDetails } from "./MediaDetails";
export function VodMovieDetails({
  movie,
  onBack,
  onPlay,
  onToggleFavourite,
}: {
  onToggleFavourite: () => void;
  movie: ShapedVodItem;
  onBack: () => void;
  onPlay: (selection: FiniteSelection) => void;
}) {
  const { t } = useLocale();
  const root = useRef<HTMLDivElement>(null);
  const favourite = usePersonal((state) =>
    state.favourites.some((item) => item.itemKey === movie.key),
  );
  const frame = useLibrary((state) => state.movieDetails[movie.key]);
  const load = useLibrary((state) => state.loadMovie);
  const progress = usePersonal((state) =>
    state.progress.find((item) => item.itemKey === movie.key),
  );
  const [action, setAction] = useState(1);
  const playIndex = frame?.state === "failed" ? 2 : 1;
  const buttons = () => [
    ...(root.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []),
  ];
  useLayoutEffect(() => {
    const targets = buttons();
    const at = Math.min(action, targets.length - 1);
    targets[at]?.focus();
    if (at !== action) setAction(at);
  }, [action, frame]);
  useEffect(() => {
    void load(movie.key);
  }, [load, movie.key]);
  const retry = () => {
    void useLibrary.getState().retry(movie.key);
  };
  useRemote((code, event) => {
    if (event.defaultPrevented) return;
    if (code === KEY.BACK || code === KEY.ESC) {
      event.preventDefault();
      onBack();
    } else if (
      code === KEY.UP ||
      code === KEY.DOWN ||
      code === KEY.LEFT ||
      code === KEY.RIGHT
    ) {
      event.preventDefault();
      const count = buttons().length;
      const delta = code === KEY.UP || code === KEY.LEFT ? -1 : 1;
      setAction((value) => (value + delta + count) % count);
    } else if (code === KEY.ENTER) {
      event.preventDefault();
      buttons()[action]?.click();
    } else if (code === 9) {
      event.preventDefault();
      const count = buttons().length;
      setAction((value) => (value + (event.shiftKey ? -1 : 1) + count) % count);
    } else if (code === KEY.GREEN) {
      event.preventDefault();
      onToggleFavourite();
    }
  });
  return (
    <div
      id="view-vod-details"
      role="dialog"
      aria-modal="true"
      aria-label={movie.name}
      ref={root}
      onFocusCapture={(event) => {
        if (!(event.target instanceof HTMLButtonElement)) return;
        const index = buttons().indexOf(event.target);
        if (index >= 0 && index !== action) setAction(index);
      }}
    >
      <div className="vod-movie-card">
        <MediaDetails
          state={frame?.state ?? "loading"}
          title={movie.name}
          trail={[movie.group, movie.name]}
          detail={frame?.value}
          itemKeys={[movie.key]}
          resumeAt={progress?.seconds}
          focused={action === playIndex}
          backFocused={action === 0}
          retryFocused={frame?.state === "failed" && action === 1}
          onBack={onBack}
          onPlay={onPlay}
          onRetry={retry}
          extraActions={
            <button
              type="button"
              className="btn tonal vod-modal-favourite"
              aria-pressed={favourite}
              onClick={onToggleFavourite}
            >
              {t(favourite ? "library.removeFavourite" : "library.addFavourite")}
            </button>
          }
        />
      </div>
    </div>
  );
}
