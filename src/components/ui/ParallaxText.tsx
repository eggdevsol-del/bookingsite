import React, { useRef } from 'react';
import { motion, useScroll, useTransform } from 'framer-motion';

interface ParallaxTextProps {
    children: React.ReactNode;
    offset?: number; // Distance to move in pixels (e.g., 50 means move 50px up/down relative to scroll)
    className?: string;
    style?: React.CSSProperties;
}

export const ParallaxText: React.FC<ParallaxTextProps> = ({
    children,
    offset = 30, // Default subtle offset
    className = "",
    style = {}
}) => {
    const ref = useRef<HTMLDivElement>(null);

    // Track scroll progress of this specific element in the viewport
    const { scrollYProgress } = useScroll({
        target: ref,
        offset: ["start end", "end start"]
    });

    // Map scroll progress (0 to 1) to transform Y (offset to -offset)
    // Positive offset makes it move slower than scroll (parallax depth)
    const y = useTransform(scrollYProgress, [0, 1], [offset, -offset]);

    return (
        <div ref={ref} className={className} style={{ position: 'relative', ...style }}>
            <motion.div style={{ y }}>
                {children}
            </motion.div>
        </div>
    );
};
