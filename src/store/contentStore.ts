import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface ContentState {
    images: Record<string, string>;
    setImage: (key: string, url: string) => void;
    getImage: (key: string, fallback: string) => string;
}

export const useContentStore = create<ContentState>()(
    persist(
        (set, get) => ({
            images: {
                'hero-main': '/src/assets/hero_bg.png', // Fallback initial state
            },
            setImage: (key, url) =>
                set((state) => ({ images: { ...state.images, [key]: url } })),
            getImage: (key, fallback) => get().images[key] || fallback,
        }),
        {
            name: 'pmason-content-storage',
        }
    )
);
