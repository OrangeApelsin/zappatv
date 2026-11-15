import type React from "react";

interface SubtitleRendererProps {
  text: string;
}

interface FormatState {
  bold: boolean;
  italic: boolean;
  underline: boolean;
}

/**
 * Decodes standard HTML entities in subtitle cues.
 */
function decodeEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

/**
 * Renders subtitle cues while obeying formatting tags (<br>, <b>, <i>, <u>, <font color="...">)
 * and stripping any unhandled tags without allowing raw markup tags to leak into the UI.
 */
export function SubtitleRenderer({ text }: SubtitleRendererProps): React.JSX.Element | null {
  if (!text) return null;

  const tagRegex = /<(\/?)([\w-]+)([^>]*)>/gi;
  const nodes: React.ReactNode[] = [];

  let lastIndex = 0;
  const state: FormatState = { bold: false, italic: false, underline: false };
  const colorStack: string[] = [];
  let keyCount = 0;

  const pushText = (rawText: string) => {
    if (!rawText) return;
    const decoded = decodeEntities(rawText);
    const lines = decoded.split(/\r?\n/);
    lines.forEach((line, lineIdx) => {
      if (lineIdx > 0) {
        nodes.push(<br key={`br-${keyCount++}`} />);
      }
      if (line.length > 0) {
        const style: React.CSSProperties = {};
        if (state.bold) style.fontWeight = "bold";
        if (state.italic) style.fontStyle = "italic";
        if (state.underline) style.textDecoration = "underline";
        if (colorStack.length > 0) style.color = colorStack[colorStack.length - 1];

        if (Object.keys(style).length > 0) {
          nodes.push(
            <span key={`span-${keyCount++}`} style={style}>
              {line}
            </span>,
          );
        } else {
          nodes.push(line);
        }
      }
    });
  };

  let match = tagRegex.exec(text);
  while (match !== null) {
    const [, isClosing, rawTagName, rawAttrs] = match;
    const tagStart = match.index;

    if (tagStart > lastIndex) {
      pushText(text.slice(lastIndex, tagStart));
    }
    lastIndex = tagRegex.lastIndex;

    const tagName = rawTagName.toLowerCase();

    if (tagName === "br") {
      nodes.push(<br key={`br-${keyCount++}`} />);
    } else if (tagName === "b" || tagName === "strong") {
      state.bold = !isClosing;
    } else if (tagName === "i" || tagName === "em") {
      state.italic = !isClosing;
    } else if (tagName === "u") {
      state.underline = !isClosing;
    } else if (tagName === "font") {
      if (isClosing) {
        colorStack.pop();
      } else {
        const colorMatch = /color=["']?([^"'\s>]+)["']?/i.exec(rawAttrs);
        if (colorMatch?.[1]) {
          colorStack.push(colorMatch[1]);
        }
      }
    }

    match = tagRegex.exec(text);
  }

  if (lastIndex < text.length) {
    pushText(text.slice(lastIndex));
  }

  return <>{nodes}</>;
}
