import { memo, useEffect, useRef, useState } from "react";
import { posters } from "../services/posters";
import { POSTER_WIDTH, POSTER_HEIGHT } from "../services/vodMetrics";

export const Poster = memo(function Poster({ src, name }: { src?: string; name: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [readyFor, setReadyFor] = useState<string>();
  const ready = !!src && readyFor === src;
  useEffect(() => {
    let live = true;
    let release: (() => void) | undefined;
    setReadyFor(undefined);
    const draw = () => {
      const image = src ? posters.peek(src) : undefined;
      const context = canvas.current?.getContext("2d");
      if (!live || !image || !context) return;
      context.clearRect(0, 0, POSTER_WIDTH, POSTER_HEIGHT);
      context.drawImage(image, 0, 0);
      setReadyFor(src);
    };
    draw();
    const timer = setTimeout(() => {
      if (src) release = posters.subscribe(src, draw);
      draw();
    }, 120);
    return () => {
      live = false;
      clearTimeout(timer);
      release?.();
    };
  }, [src]);
  return (
    <span className="poster-art" role="img" aria-label={name}>
      {!ready && <span className="vod-poster-ph">{name}</span>}
      <canvas
        ref={canvas}
        width={POSTER_WIDTH}
        height={POSTER_HEIGHT}
        style={{ display: ready ? "block" : "none" }}
      />
    </span>
  );
});
