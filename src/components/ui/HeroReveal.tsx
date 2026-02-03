import React from 'react';
import { motion, useScroll, useTransform } from 'framer-motion';

interface HeroRevealProps {
    children: React.ReactNode;
    className?: string;
}

export const HeroReveal: React.FC<HeroRevealProps> = ({
    children,
    className = ""
}) => {
    // Track global page scroll
    const { scrollY } = useScroll();

    // Map scroll pixels to opacity:
    // 0px (Top): 0 Opacity (Invisible)
    // 150px (Scrolled): 1 Opacity (Fully Visible)
    // The text reveals as you start scrolling down.
    const opacity = useTransform(scrollY, [0, 150], [0, 1]);

    // Optional: Slight scale up as it reveals for effect
    const scale = useTransform(scrollY, [0, 150], [0.95, 1]);

    return (
        <motion.div className={className} style={{ opacity, scale }}>
            {children}
        </motion.div>
    );
};
