import { create } from 'zustand';

interface UIState {
    isBookingOpen: boolean;
    openBooking: () => void;
    closeBooking: () => void;
    toggleBooking: () => void;
}

export const useUIStore = create<UIState>((set) => ({
    isBookingOpen: false,
    openBooking: () => set({ isBookingOpen: true }),
    closeBooking: () => set({ isBookingOpen: false }),
    toggleBooking: () => set((state) => ({ isBookingOpen: !state.isBookingOpen })),
}));
