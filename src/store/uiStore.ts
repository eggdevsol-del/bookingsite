import { create } from 'zustand';

interface UIState {
    isBookingOpen: boolean;
    isAboutOpen: boolean;
    isCreativeFreedomOpen: boolean;
    openBooking: () => void;
    closeBooking: () => void;
    toggleBooking: () => void;
    openAbout: () => void;
    closeAbout: () => void;
    openCreativeFreedom: () => void;
    closeCreativeFreedom: () => void;
}

export const useUIStore = create<UIState>((set) => ({
    isBookingOpen: false,
    isAboutOpen: false,
    isCreativeFreedomOpen: false,
    openBooking: () => set({ isBookingOpen: true }),
    closeBooking: () => set({ isBookingOpen: false }),
    toggleBooking: () => set((state) => ({ isBookingOpen: !state.isBookingOpen })),
    openAbout: () => set({ isAboutOpen: true }),
    closeAbout: () => set({ isAboutOpen: false }),
    openCreativeFreedom: () => set({ isCreativeFreedomOpen: true }),
    closeCreativeFreedom: () => set({ isCreativeFreedomOpen: false }),
}));
