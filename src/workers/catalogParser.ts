/** Strict incremental array framing. Only complete object records can be accepted;
 * nested JSON is validated by JSON.parse, and the complete root must close.
 */
export class CatalogParser {
  private state: "open" | "first" | "value" | "separator" | "done" = "open";
  private stack: string[] = [];
  private parts: string[] = [];
  private quoted = false;
  private escaped = false;
  private beginning = true;
  constructor(private readonly record: (raw: Record<string, unknown>) => void) {}

  feed(text: string): void {
    let start = this.stack.length ? 0 : -1;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (this.beginning) {
        this.beginning = false;
        if (c === "\uFEFF") continue;
      }
      if (this.stack.length) {
        if (this.quoted) {
          if (this.escaped) this.escaped = false;
          else if (c === "\\") this.escaped = true;
          else if (c === '"') this.quoted = false;
        } else if (c === '"') this.quoted = true;
        else if (c === "{" || c === "[") this.stack.push(c);
        else if (c === "}" || c === "]") {
          if (this.stack.pop() !== (c === "}" ? "{" : "["))
            throw new Error("Malformed catalog JSON");
          if (!this.stack.length) {
            this.parts.push(text.slice(start, i + 1));
            const value: unknown = JSON.parse(this.parts.join(""));
            if (!value || typeof value !== "object" || Array.isArray(value))
              throw new Error("Invalid catalog record");
            this.record(value as Record<string, unknown>);
            this.parts = [];
            start = -1;
            this.state = "separator";
          }
        }
        continue;
      }
      if (c === " " || c === "\t" || c === "\r" || c === "\n") continue;
      if (this.state === "open" && c === "[") this.state = "first";
      else if ((this.state === "first" || this.state === "value") && c === "{") {
        this.stack.push(c);
        start = i;
      } else if ((this.state === "first" || this.state === "separator") && c === "]")
        this.state = "done";
      else if (this.state === "separator" && c === ",") this.state = "value";
      else throw new Error("Malformed catalog array");
    }
    if (start >= 0) this.parts.push(text.slice(start));
  }

  finish(): void {
    if (this.state !== "done" || this.stack.length || this.quoted)
      throw new Error("Incomplete catalog JSON");
  }
}

/** Old-engine fallback with the same UTF-8 behavior across slice boundaries. */
export class CatalogDecoder {
  private native =
    typeof TextDecoder === "undefined" ? null : new TextDecoder("utf-8", { fatal: true });
  private pending: number[] = [];
  decode(bytes: Uint8Array, final = false): string {
    if (this.native) return this.native.decode(bytes, { stream: !final });
    const data = new Uint8Array(this.pending.length + bytes.length);
    data.set(this.pending);
    data.set(bytes, this.pending.length);
    this.pending = [];
    const chars: string[] = [];
    for (let i = 0; i < data.length; ) {
      const first = data[i];
      const count =
        first < 0x80
          ? 1
          : first >= 0xc2 && first <= 0xdf
            ? 2
            : first >= 0xe0 && first <= 0xef
              ? 3
              : first >= 0xf0 && first <= 0xf4
                ? 4
                : 0;
      if (!count) throw new Error("Invalid UTF-8 catalog");
      if (i + count > data.length) {
        if (final) throw new Error("Incomplete UTF-8 catalog");
        this.pending = Array.from(data.subarray(i));
        break;
      }
      let point = first & (count === 1 ? 0x7f : 0x7f >> count);
      for (let n = 1; n < count; n++) {
        const next = data[i + n];
        if ((next & 0xc0) !== 0x80) throw new Error("Invalid UTF-8 catalog");
        point = (point << 6) | (next & 0x3f);
      }
      if (
        (count === 2 && point < 0x80) ||
        (count === 3 && point < 0x800) ||
        (count === 4 && point < 0x10000) ||
        point > 0x10ffff ||
        (point >= 0xd800 && point <= 0xdfff)
      )
        throw new Error("Invalid UTF-8 catalog");
      chars.push(
        point <= 0xffff
          ? String.fromCharCode(point)
          : String.fromCharCode(
              0xd800 + ((point - 0x10000) >> 10),
              0xdc00 + ((point - 0x10000) & 0x3ff),
            ),
      );
      i += count;
    }
    return chars.join("");
  }
}
