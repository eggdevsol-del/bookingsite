import React from 'react';
import { useUIStore } from '../../store/uiStore';
import styles from './PromoBanner.module.css';

export const PromoBanner: React.FC = () => {
    const openCreativeFreedom = useUIStore((state) => state.openCreativeFreedom);

    return (
        <div className={styles.promoBanner} onClick={openCreativeFreedom}>
            <p className={styles.promoText}>
                LIMITED TIME OFFER <span className={styles.promoHighlight}>50% OFF</span> FULL CREATIVE FREEDOM LARGE SCALE WORKS - <span className={styles.promoHighlight}>CLICK HERE TO INQUIRE</span>
            </p>
        </div>
    );
};
