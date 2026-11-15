import { useEffect, useState } from "react";

export function Screensaver() {
  const [time, setTime] = useState(() => {
    const d = new Date();
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  });

  useEffect(() => {
    const timer = setInterval(() => {
      const d = new Date();
      setTime(d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
    }, 10000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div
      className="screensaver-overlay"
      data-testid="screensaver"
      aria-live="off"
      role="presentation"
    >
      <div className="screensaver-drift">
        <div className="screensaver-clock">{time}</div>
        <div className="screensaver-brand">ZAPPA TV</div>
      </div>
    </div>
  );
}

