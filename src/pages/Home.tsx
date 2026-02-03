import React from 'react';
import { EditableImage } from '../components/ui/EditableImage';
import { GoldButton } from '../components/ui/GoldButton';
import { ScrollReveal } from '../components/ui/ScrollReveal';
import { HeroReveal } from '../components/ui/HeroReveal';
import { PromoBanner } from '../components/ui/PromoBanner';
import { useUIStore } from '../store/uiStore';
import styles from './Home.module.css';

export const Home: React.FC = () => {
    const openBooking = useUIStore((state) => state.openBooking);



    return (
        <div className={styles.page}>

            {/* SPLIT HERO SECTION */}
            <section className={styles.splitHero}>
                {/* Left Statue (Video: Studio) */}
                <div className={styles.heroLeft}>
                    <EditableImage
                        contentKey="hero-statue"
                        defaultSrc="/media/studio.webm"
                        alt="Classical Studio Video"
                        className={styles.heroImg}
                    />
                    <div className={styles.heroGradientLeft}></div>
                </div>

                {/* Right Model (Video: Lioness) */}
                <div className={styles.heroRight}>
                    <EditableImage
                        contentKey="hero-model"
                        defaultSrc="/media/lioness.webm"
                        alt="Lioness Video"
                        className={styles.heroImg}
                    />
                    <div className={styles.heroGradientRight}></div>
                </div>

                {/* Center Overlay Content */}
                <div className={styles.heroCenterContent}>
                    <div className={styles.titleWrapper}>
                        <h1 className={styles.mainTitle}>
                            <span className={styles.titleTop}>PIRIPI MASON</span>
                            <span className={styles.titleSub}>TATTOO ARTIST</span>
                        </h1>

                        <HeroReveal>
                            <h2 className={styles.heroHeadline}>
                                Craftsmanship Without Compromise.
                            </h2>
                        </HeroReveal>

                        <HeroReveal>
                            <p className={styles.heroByline}>BRISBANE BASED AWARD WINNING REALISM TATTOO ARTISTRY</p>
                        </HeroReveal>

                        <HeroReveal>
                            <div className={styles.heroCta}>
                                <GoldButton className={styles.heroBtn} onClick={openBooking}>REQUEST CONSULTATION</GoldButton>
                                <span className={styles.inquiryEmail}>Enquiries: bookings@pmasontattoo.com</span>
                            </div>
                        </HeroReveal>
                    </div>
                </div>
            </section>

            {/* PROMOTIONAL BANNER */}
            <PromoBanner />

            {/* TRUST STATS */}
            <section className={styles.trustStats}>
                <div className={styles.statItem}>
                    <ScrollReveal>
                        <span className={styles.statValue}>300+</span>
                        <span className={styles.statLabel}>Satisfied Returning Clients</span>
                    </ScrollReveal>
                </div>
                <div className={styles.statItem}>
                    <ScrollReveal>
                        <span className={styles.statValue}>Private</span>
                        <span className={styles.statLabel}>Purpose Built Studio</span>
                    </ScrollReveal>
                </div>
                <div className={styles.statItem}>
                    <ScrollReveal>
                        <span className={styles.statValue}>5.0</span>
                        <span className={styles.statLabel}>Star Google Reviews</span>
                    </ScrollReveal>
                </div>
                <div className={styles.statItem}>
                    <ScrollReveal>
                        <span className={styles.statValue}>13</span>
                        <span className={styles.statLabel}>Years Industry Experience</span>
                    </ScrollReveal>
                </div>
            </section>

            {/* FOOTER CTA */}
            <section className={styles.footerCta}>
                <ScrollReveal>
                    <h3>COMMISSION YOUR MASTERPIECE</h3>
                </ScrollReveal>
                <ScrollReveal>
                    <p>Begin the dialogue for your bespoke body art.</p>
                </ScrollReveal>
                <ScrollReveal>
                    <div style={{ marginTop: '2rem', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                        <GoldButton onClick={openBooking}>REQUEST CONSULTATION</GoldButton>
                        <span className={styles.inquiryEmail}>Enquiries: bookings@pmasontattoo.com</span>
                    </div>
                </ScrollReveal>
            </section>

        </div>
    );
};
