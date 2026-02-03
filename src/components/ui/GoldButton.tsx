import React, { ReactNode } from 'react';
import styles from './GoldButton.module.css';

interface GoldButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    children: ReactNode;
    variant?: 'solid' | 'outline';
}

export const GoldButton: React.FC<GoldButtonProps> = ({
    children,
    variant = 'solid',
    className = '',
    ...props
}) => {
    return (
        <button
            className={`${styles.btn} ${styles[variant]} ${className}`}
            {...props}
        >
            <span className={styles.content}>{children}</span>
            <span className={styles.borderEffect}></span>
        </button>
    );
};
