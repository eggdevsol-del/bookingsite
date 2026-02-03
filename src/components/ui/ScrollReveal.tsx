import React, { useRef } from 'react';
import { motion, useScroll, useTransform } from 'framer-motion';

interface ScrollRevealProps {
    children: React.ReactNode;
    className?: string;
    style?: React.CSSProperties;
}

export const ScrollReveal: React.FC<ScrollRevealProps> = ({
    children,
    className = "",
    style = {}
}) => {
    const ref = useRef<HTMLDivElement>(null);

    // Track scroll progress of this specific element in the viewport
    const { scrollYProgress } = useScroll({
        target: ref,
        offset: ["start end", "end start"]
    });

    // Map scroll progress to opacity:
    // 0.0 - 0.2: Fade In (enters bottom)
    // 0.2 - 0.8: Fully Visible (center viewport)
    // 0.8 - 1.0: Fade Out (leaves top)
    // 1:1 mapping with scroll position, no time-based transition
    const opacity = useTransform(scrollYProgress, [0, 0.2, 0.8, 1], [0, 1, 1, 0]);
    const scale = useTransform(scrollYProgress, [0, 0.2, 0.8, 1], [0.95, 1, 1, 0.95]); // Subtle scale for extra polish

    return (
        <div ref={ref} className={className} style={style}>
            <motion.div style={{ opacity, scale }}>
                {children}
            </motion.div>
        </div>
    );
};
