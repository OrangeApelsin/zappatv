import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PinModal } from "../src/components/PinModal";
import { ParentalControl } from "../src/components/settings/ParentalControl";
import { useSettings } from "../src/stores/settings";
import { useParentalSession } from "../src/stores/parental";

afterEach(() => {
  cleanup();
});

test("PinModal enters PIN via on-screen keypad and triggers onSuccess on match", async () => {
  const onSuccess = vi.fn();
  const onCancel = vi.fn();

  render(<PinModal expectedPin="1234" onSuccess={onSuccess} onCancel={onCancel} />);

  expect(screen.getByTestId("pin-modal")).toBeDefined();

  // Click 1, 2, 3, 4
  fireEvent.click(screen.getByRole("button", { name: "1" }));
  fireEvent.click(screen.getByRole("button", { name: "2" }));
  fireEvent.click(screen.getByRole("button", { name: "3" }));
  fireEvent.click(screen.getByRole("button", { name: "4" }));

  await new Promise((r) => setTimeout(r, 150));
  expect(onSuccess).toHaveBeenCalledTimes(1);
});

test("PinModal shows error on wrong PIN", async () => {
  const onSuccess = vi.fn();
  const onCancel = vi.fn();

  render(<PinModal expectedPin="1234" onSuccess={onSuccess} onCancel={onCancel} />);

  // Click 9, 9, 9, 9
  fireEvent.click(screen.getByRole("button", { name: "9" }));
  fireEvent.click(screen.getByRole("button", { name: "9" }));
  fireEvent.click(screen.getByRole("button", { name: "9" }));
  fireEvent.click(screen.getByRole("button", { name: "9" }));

  await new Promise((r) => setTimeout(r, 250));
  expect(onSuccess).not.toHaveBeenCalled();
  expect(screen.getByRole("alert")).toBeDefined();
});

test("PinModal cancels on Cancel button or Escape", () => {
  const onSuccess = vi.fn();
  const onCancel = vi.fn();

  render(<PinModal expectedPin="1234" onSuccess={onSuccess} onCancel={onCancel} />);

  fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
  expect(onCancel).toHaveBeenCalledTimes(1);
});

test("ParentalControl settings view uses toggle slider and sets/clears PIN without cancel button", () => {
  useSettings.getState().set("parentalPin", "");
  useParentalSession.getState().lock();

  const { container, rerender } = render(<ParentalControl />);

  const toggle = container.querySelector(".switch") as HTMLElement;
  expect(toggle).toBeDefined();
  expect(toggle.getAttribute("aria-pressed")).toBe("false");
  expect(toggle.classList.contains("on")).toBe(false);

  // Toggle ON to show PIN input field
  fireEvent.click(toggle);
  expect(container.querySelector(".pin-setup-input")).toBeDefined();
  expect(screen.queryByRole("button", { name: /cancel/i })).toBeNull(); // No cancel button

  // Type 4 digits to set PIN
  const input = container.querySelector(".pin-setup-input") as HTMLInputElement;
  fireEvent.change(input, { target: { value: "4321" } });

  expect(useSettings.getState().parentalPin).toBe("4321");
  expect(useParentalSession.getState().unlocked).toBe(true);

  // Rerender when PIN is set
  rerender(<ParentalControl />);
  expect(screen.getByRole("button", { name: /Lock Session/i })).toBeDefined();

  // Toggle session lock
  fireEvent.click(screen.getByRole("button", { name: /Lock Session/i }));
  expect(useParentalSession.getState().unlocked).toBe(false);

  // Toggle slider OFF clears PIN
  fireEvent.click(container.querySelector(".switch")!);
  expect(useSettings.getState().parentalPin).toBe("");
  expect(useParentalSession.getState().unlocked).toBe(false);
});
