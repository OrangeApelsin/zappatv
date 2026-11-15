/** Native messages can contain authenticated stream URLs. Expose the error
 * identity/status and known startup stage, never the native free-text message. */
export function playbackFailureCode(raw: string): string {
  const identity =
    raw.match(
      /\b(?:PLAYER_ERROR_[A-Z_]+|[A-Za-z]*Error|[A-Za-z]*Exception|TIMEOUT|STALLED|TV_ONLY|STREAM_ENDED)\b/,
    )?.[0] ?? "UNKNOWN_NATIVE_ERROR";
  const status = raw.match(/\bhttp\s+([1-5][0-9]{2})\b/i)?.[1];
  return `${identity}${status ? ` (http ${status})` : ""}`;
}
