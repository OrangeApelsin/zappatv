import { create } from "zustand";

interface ParentalSessionState {
  unlocked: boolean;
  unlock: () => void;
  lock: () => void;
}

export const useParentalSession = create<ParentalSessionState>((set) => ({
  unlocked: false,
  unlock: () => set({ unlocked: true }),
  lock: () => set({ unlocked: false }),
}));

