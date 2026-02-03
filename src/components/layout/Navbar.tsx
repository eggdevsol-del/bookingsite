import React, { useState, useEffect } from 'react';
import { Menu, X, Instagram, Facebook } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { useUIStore } from '../../store/uiStore';
import styles from './Navbar.module.css';

export const Navbar: React.FC = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [scrolled, setScrolled] = useState(false);
    const location = useLocation();
    const { openBooking, openAbout } = useUIStore((state) => state);

    useEffect(() => {
        const handleScroll = () => {
            setScrolled(window.scrollY > 50);
        };
        window.addEventListener('scroll', handleScroll);
        return () => window.removeEventListener('scroll', handleScroll);
    }, []);

    const toggleMenu = () => setIsOpen(!isOpen);

    useEffect(() => {
        setIsOpen(false);
    }, [location]);

    return (
        <nav className={`${styles.nav} ${scrolled ? styles.scrolled : ''}`}>
            <div className={styles.container}>
                {/* Left Links */}
                <div className={styles.desktopNavLeft}>
                    <button
                        className={styles.link}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}
                        onClick={openAbout}
                    >
                        ABOUT
                    </button>
                </div>

                {/* Center Logo */}
                <Link to="/" className={styles.logo}>
                    {/* Image removed */}
                </Link>

                {/* Right Links */}
                <div className={styles.desktopNavRight}>
                    <button
                        className={styles.link}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}
                        onClick={openBooking}
                    >
                        BOOKING
                    </button>
                    <span style={{ color: '#444' }}>|</span>
                    <Link to="/contact" className={styles.link}>CONTACT</Link>
                    <div className={styles.socials}>
                        <a href="#" className={styles.socialLink}><Instagram size={16} /></a>
                        <a href="#" className={styles.socialLink}><Facebook size={16} /></a>
                    </div>
                </div>

                {/* Mobile Toggle */}
                <button className={styles.mobileToggle} onClick={toggleMenu} aria-label="Menu">
                    {isOpen ? <X color="#d4af37" /> : <Menu color="#d4af37" />}
                </button>

                {/* Mobile Nav */}
                <div className={`${styles.mobileMenu} ${isOpen ? styles.open : ''}`}>
                    <Link to="/" className={styles.mobileLink}>Home</Link>
                    <button
                        className={styles.mobileLink}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
                        onClick={() => {
                            openAbout();
                            setIsOpen(false);
                        }}
                    >
                        About
                    </button>
                    <button
                        className={styles.mobileLink}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
                        onClick={() => {
                            openBooking();
                            setIsOpen(false);
                        }}
                    >
                        Booking
                    </button>
                    <div className={styles.mobileSocials} style={{ display: 'flex', gap: '2rem', marginTop: '2rem' }}>
                        <a href="#" style={{ color: '#d4af37' }}><Instagram size={32} /></a>
                        <a href="#" style={{ color: '#d4af37' }}><Facebook size={32} /></a>
                    </div>
                </div>
            </div>
        </nav>
    );
};
