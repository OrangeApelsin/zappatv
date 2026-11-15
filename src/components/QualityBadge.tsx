import type { VideoQualityTier } from "../services/playbackLabels";
import { normalizeQualityTier } from "../services/playbackLabels";

function TierIcon({ tier }: { tier: VideoQualityTier }) {
  // Crisp inline SVG icon per tier with no <text> nodes so badge textContent stays pure.
  switch (tier) {
    case "4K":
      return (
        <svg className="pb-quality-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <rect x="2" y="4" width="20" height="15" rx="2" />
          <path d="M8 21h8" />
          <path d="M12 10l1.4-2.8L14.8 10l2.8 1.4-2.8 1.4L13.4 15.6 12 12.8 9.2 11.4z" />
        </svg>
      );
    case "FHD":
      return (
        <svg className="pb-quality-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <rect x="2" y="4" width="20" height="15" rx="2" />
          <path d="M8 21h8" />
          <path d="M7 9h10M7 12h10M7 15h6" />
        </svg>
      );
    case "HD":
      return (
        <svg className="pb-quality-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <rect x="2" y="4" width="20" height="15" rx="2" />
          <path d="M8 21h8" />
          <path d="M7 10h10M7 14h10" />
        </svg>
      );
    case "SD":
      return (
        <svg className="pb-quality-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="M8 21h8" />
          <path d="M8 12h8" />
        </svg>
      );
  }
}

export function QualityBadge({ quality }: { quality?: string | null }) {
  if (!quality) return null;
  const tier = normalizeQualityTier(quality);
  if (!tier) {
    return <span className="pb-quality">{quality}</span>;
  }
  return (
    <span className={`pb-quality pb-quality-${tier.toLowerCase()}`} data-quality={tier}>
      <TierIcon tier={tier} />
      {tier}
    </span>
  );
}
