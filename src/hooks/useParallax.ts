import { useEffect, useRef } from 'react';

/**
 * useParallax Hook
 * 
 * Applies a parallax effect to the target element.
 * @param speed - The speed factor. 0 is static, >0 moves slower, <0 moves faster/inverted.
 * @param offset - Initial offset in pixels.
 */
export const useParallax = (speed: number = 0.5, offset: number = 0) => {
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const element = ref.current;
        if (!element) return;

        let rafId: number;

        const updatePosition = () => {
            const scrollY = window.scrollY;
            const elementTop = element.offsetTop;
            const elementHeight = element.offsetHeight;
            const windowHeight = window.innerHeight;

            // Only animate if element is in viewport (plus some buffer)
            if (scrollY + windowHeight > elementTop - 100 && scrollY < elementTop + elementHeight + 100) {
                // Calculate relative scroll position
                const relativeScroll = scrollY - elementTop;
                const translation = relativeScroll * speed + offset;

                element.style.transform = `translate3d(0, ${translation}px, 0)`;
                element.style.willChange = 'transform';
            }

            rafId = requestAnimationFrame(updatePosition);
        };

        updatePosition();

        return () => {
            cancelAnimationFrame(rafId);
            if (element) {
                element.style.transform = 'none';
                element.style.willChange = 'auto';
            }
        };
    }, [speed, offset]);

    return ref;
};
