import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { useUIStore } from '../../store/uiStore';
import styles from './AboutSheet.module.css';
import aboutPortrait from '../../assets/about-portrait.jpg';

export const AboutSheet: React.FC = () => {
    const { isAboutOpen, closeAbout } = useUIStore();

    // Prevent background scroll when open
    useEffect(() => {
        if (isAboutOpen) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = 'auto';
        }
        return () => { document.body.style.overflow = 'auto'; };
    }, [isAboutOpen]);

    return (
        <div className={`${styles.overlay} ${isAboutOpen ? styles.open : ''}`}>
            <div className={styles.sheet}>
                <button className={styles.closeBtn} onClick={closeAbout}>
                    <X size={24} />
                </button>

                {/* Left Side: Portrait */}
                <div className={styles.imageSide}>
                    <img src={aboutPortrait} alt="Piripi Mason" className={styles.profileImg} />
                </div>

                {/* Right Side: Text Content */}
                <div className={styles.contentSide}>
                    <h2 className={styles.title}>THE STANDARD</h2>
                    <p className={styles.subtitle}>EST. 2024</p>

                    <div className={styles.textBlock}>
                        <p>
                            Tattooing at this level is not about speed, volume, or price. It is about <span className={styles.highlight}>control, precision, and uncompromising standards.</span>
                        </p>
                        <p>
                            Every piece is designed in-house, custom-built for the client, and executed with obsessive attention to detail. From concept to healing, nothing is left to chance. Materials, technique, placement, and longevity are all considered at a professional level.
                        </p>
                        <p>
                            This studio operates on selectivity, not availability. I work with a limited number of clients to ensure every project receives full focus, proper preparation, and flawless execution.
                        </p>
                        <p>
                            My work is sought after because it is consistent, refined, and built to last. My rates reflect the time, experience, and responsibility that come with permanent art done correctly.
                        </p>
                        <p>
                            This is not a walk-in shop.<br />
                            This is not fast fashion.<br />
                            This is not bargain tattooing.
                        </p>
                        <p>
                            This is a private, high-standard experience for clients who value excellence.
                        </p>
                        <p style={{ marginTop: '2rem' }}>
                            If you’re looking for the cheapest option, you won’t find it here.
                        </p>
                        <p className={styles.highlight}>
                            If you’re looking for elite craftsmanship and work that stands the test of time, welcome.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
};
