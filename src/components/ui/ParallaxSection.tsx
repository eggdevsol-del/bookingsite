import React, { ReactNode } from 'react';
import { useParallax } from '../../hooks/useParallax';
import styles from './ParallaxSection.module.css'; // We'll create this next

interface ParallaxSectionProps {
    children: ReactNode;
    speed?: number;
    className?: string;
    style?: React.CSSProperties;
    backgroundImage?: string;
}

export const ParallaxSection: React.FC<ParallaxSectionProps> = ({
    children,
    speed = 0.5,
    className = '',
    style = {},
    backgroundImage
}) => {
    const parallaxRef = useParallax(speed);

    const containerStyle: React.CSSProperties = {
        ...style,
        ...(backgroundImage ? { backgroundImage: `url(${backgroundImage})` } : {}),
    };

    return (
        <div className={`${styles.container} ${className}`} style={{ overflow: 'hidden', position: 'relative' }}>
            <div ref={parallaxRef} className={styles.content} style={containerStyle}>
                {children}
            </div>
        </div>
    );
};
