import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { SubtitleRenderer } from "../src/components/SubtitleRenderer";

describe("SubtitleRenderer", () => {
  it("renders null for empty string", () => {
    const { container } = render(<SubtitleRenderer text="" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders plain text without tags", () => {
    const { container } = render(<SubtitleRenderer text="Hello world" />);
    expect(container.textContent).toBe("Hello world");
  });

  it("obeys <br>, <br/>, and <br /> line breaks", () => {
    const { container } = render(
      <SubtitleRenderer text="Line 1<br>Line 2<br/>Line 3<br />Line 4" />,
    );
    const brs = container.querySelectorAll("br");
    expect(brs.length).toBe(3);
    expect(container.textContent).toContain("Line 1");
    expect(container.textContent).toContain("Line 4");
    expect(container.textContent).not.toContain("<br");
    expect(container.innerHTML).not.toContain("&lt;br");
  });

  it("obeys <b> and <strong> bold tags", () => {
    const { container } = render(
      <SubtitleRenderer text="Normal <b>Bold 1</b> and <strong>Bold 2</strong>" />,
    );
    const spans = container.querySelectorAll("span");
    expect(spans.length).toBe(2);
    expect(spans[0].style.fontWeight).toBe("bold");
    expect(spans[0].textContent).toBe("Bold 1");
    expect(spans[1].style.fontWeight).toBe("bold");
    expect(spans[1].textContent).toBe("Bold 2");
    expect(container.innerHTML).not.toContain("&lt;b&gt;");
  });

  it("obeys <i> and <em> italic tags", () => {
    const { container } = render(
      <SubtitleRenderer text="Plain <i>Italic text</i> and <em>Emphasis</em>" />,
    );
    const spans = container.querySelectorAll("span");
    expect(spans.length).toBe(2);
    expect(spans[0].style.fontStyle).toBe("italic");
    expect(spans[0].textContent).toBe("Italic text");
    expect(spans[1].style.fontStyle).toBe("italic");
    expect(spans[1].textContent).toBe("Emphasis");
  });

  it("obeys <u> underline tags", () => {
    const { container } = render(
      <SubtitleRenderer text="<u>Underlined headline</u>" />,
    );
    const span = container.querySelector("span");
    expect(span?.style.textDecoration).toBe("underline");
    expect(span?.textContent).toBe("Underlined headline");
  });

  it("obeys <font color='...'> color tags", () => {
    const { container } = render(
      <SubtitleRenderer text='<font color="#ffff00">Yellow warning</font> and <font color="red">Red</font>' />,
    );
    const spans = container.querySelectorAll("span");
    expect(spans.length).toBe(2);
    expect(spans[0].style.color).toBe("rgb(255, 255, 0)");
    expect(spans[0].textContent).toBe("Yellow warning");
    expect(spans[1].style.color).toBe("red");
    expect(spans[1].textContent).toBe("Red");
  });

  it("handles nested bold, italic, and color tags", () => {
    const { container } = render(
      <SubtitleRenderer text='<b><i><font color="cyan">Bold italic cyan</font></i></b>' />,
    );
    const span = container.querySelector("span");
    expect(span?.style.fontWeight).toBe("bold");
    expect(span?.style.fontStyle).toBe("italic");
    expect(span?.style.color).toBe("cyan");
    expect(span?.textContent).toBe("Bold italic cyan");
  });

  it("strips unhandled tags without rendering raw tag markup", () => {
    const { container } = render(
      <SubtitleRenderer text='<script>alert("xss")</script><unknown-tag>Safe content</unknown-tag>' />,
    );
    expect(container.textContent).toBe('alert("xss")Safe content');
    expect(container.innerHTML).not.toContain("<script");
    expect(container.innerHTML).not.toContain("<unknown-tag");
  });

  it("decodes HTML entities properly", () => {
    const { container } = render(
      <SubtitleRenderer text="Tom &amp; Jerry &quot;Show&quot; &lt;3" />,
    );
    expect(container.textContent).toBe('Tom & Jerry "Show" <3');
  });

  it("handles newlines inside text string", () => {
    const { container } = render(
      <SubtitleRenderer text={"First line\nSecond line\r\nThird line"} />,
    );
    const brs = container.querySelectorAll("br");
    expect(brs.length).toBe(2);
    expect(container.textContent).toContain("First line");
    expect(container.textContent).toContain("Third line");
  });
});
