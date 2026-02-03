import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AuthState {
    isAdmin: boolean;
    login: (password: string) => boolean;
    logout: () => void;
    toggleAdmin: () => void; // Dev helper
}

export const useAuthStore = create<AuthState>()(
    persist(
        (set, get) => ({
            isAdmin: false,
            login: (password) => {
                if (password === 'admin') {
                    set({ isAdmin: true });
                    return true;
                }
                return false;
            },
            logout: () => set({ isAdmin: false }),
            toggleAdmin: () => set({ isAdmin: !get().isAdmin }),
        }),
        { name: 'pmason-auth-storage' }
    )
);
