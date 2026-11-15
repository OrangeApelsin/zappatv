import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { InputShield } from "../src/components/InputShield";
import { KEY } from "../src/hooks/useRemote";

describe("InputShield (Enter-to-Edit)", () => {
  afterEach(() => {
    cleanup();
  });

  test("renders in read-only mode by default to suppress TV IME keyboard", () => {
    render(<InputShield id="test-input" placeholder="Type here" value="Hello" />);
    const input = screen.getByPlaceholderText<HTMLInputElement>("Type here");
    expect(input.readOnly).toBe(true);
    expect(input.classList.contains("locked")).toBe(true);
  });

  test("maintains read-only mode when receiving focus from D-pad", () => {
    render(<InputShield id="test-input" placeholder="Type here" value="Hello" />);
    const input = screen.getByPlaceholderText<HTMLInputElement>("Type here");
    fireEvent.focus(input);

    expect(input.readOnly).toBe(true);
    expect(input.classList.contains("locked")).toBe(true);
  });

  test("enters edit mode on Enter/OK key, unlocking read-only", () => {
    render(<InputShield id="test-input" placeholder="Type here" value="Hello" />);
    const input = screen.getByPlaceholderText<HTMLInputElement>("Type here");
    fireEvent.focus(input);

    // Press OK/Enter to begin editing
    fireEvent.keyDown(input, { keyCode: KEY.ENTER });
    expect(input.readOnly).toBe(false);
    expect(input.classList.contains("editing")).toBe(true);
  });

  test("commits value and locks field again on Enter key while editing", () => {
    const onCommit = vi.fn();
    render(
      <InputShield id="test-input" placeholder="Type here" value="Hello" onCommit={onCommit} />,
    );
    const input = screen.getByPlaceholderText<HTMLInputElement>("Type here");
    fireEvent.focus(input);
    fireEvent.keyDown(input, { keyCode: KEY.ENTER });
    expect(input.readOnly).toBe(false);

    // Commit via Enter
    fireEvent.keyDown(input, { keyCode: KEY.ENTER });
    expect(input.readOnly).toBe(true);
    expect(onCommit).toHaveBeenCalledWith("Hello");
  });

  test("cancels editing and locks field on Back/ESC key", () => {
    const onCancel = vi.fn();
    render(
      <InputShield id="test-input" placeholder="Type here" value="Hello" onCancel={onCancel} />,
    );
    const input = screen.getByPlaceholderText<HTMLInputElement>("Type here");
    fireEvent.focus(input);
    fireEvent.keyDown(input, { keyCode: KEY.ENTER });
    expect(input.readOnly).toBe(false);

    // Cancel via Back
    fireEvent.keyDown(input, { keyCode: KEY.BACK });
    expect(input.readOnly).toBe(true);
    expect(onCancel).toHaveBeenCalled();
  });
});

test("composition Enter keeps editing and its text until a later Done", () => {
  const commit = vi.fn();
  render(
    <>
      <label htmlFor="composition">Playlist</label>
      <InputShield id="composition" defaultValue="Åäö العربية" onCommit={commit} />
    </>,
  );
  const input = screen.getByLabelText<HTMLInputElement>("Playlist");
  fireEvent.keyDown(input, { keyCode: KEY.ENTER });
  fireEvent.keyDown(input, { keyCode: KEY.ENTER, isComposing: true });
  expect(input.readOnly).toBe(false);
  expect(commit).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { keyCode: KEY.ENTER });
  expect(input.readOnly).toBe(true);
  expect(commit).toHaveBeenCalledWith("Åäö العربية");
});
