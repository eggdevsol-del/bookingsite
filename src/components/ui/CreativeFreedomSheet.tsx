import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { GoldButton } from './GoldButton';
import { useUIStore } from '../../store/uiStore';
import styles from './BookingSheet.module.css';

export const CreativeFreedomSheet: React.FC = () => {
    const { isCreativeFreedomOpen, closeCreativeFreedom } = useUIStore();

    const [formData, setFormData] = useState({
        name: '',
        email: '',
        phone: '',
        placement: '',
        description: '',
        budget: ''
    });

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();

        // Modified subject line with "CREATIVE FREEDOM" prefix
        const subject = `CREATIVE FREEDOM - Inquiry Tattoo: ${formData.name ? formData.name : 'New Client'} - ${formData.placement}`;

        const body = `
*** CREATIVE FREEDOM PROJECT INQUIRY ***

-- CLIENT DETAILS --
Name: ${formData.name}
Email: ${formData.email}
Phone: ${formData.phone}

-- PROJECT INFO --
Placement: ${formData.placement}
Budget: ${formData.budget}

-- DESCRIPTION --
${formData.description}

__________________________

** PLEASE ATTACH YOUR REFERENCES AND BODY PHOTOS TO THIS EMAIL **
__________________________
Sent via P Mason Tattoo App - Creative Freedom Promo`.trim();

        const mailtoLink = `mailto:pmason@example.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

        window.location.href = mailtoLink;
        closeCreativeFreedom();
    };

    // Prevent background scroll when open
    useEffect(() => {
        if (isCreativeFreedomOpen) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = 'auto';
        }
        return () => { document.body.style.overflow = 'auto'; };
    }, [isCreativeFreedomOpen]);

    return (
        <div className={`${styles.overlay} ${isCreativeFreedomOpen ? styles.open : ''}`}>
            <div className={styles.sheet}>
                <button className={styles.closeBtn} onClick={closeCreativeFreedom}>
                    <X size={24} />
                </button>

                <div className={styles.content}>
                    <h2 className={styles.title}>CREATIVE FREEDOM PROJECT</h2>
                    <p className={styles.subtitle}>LIMITED TIME 50% OFF</p>

                    <form className={styles.form} onSubmit={handleSubmit}>
                        <div className={styles.group}>
                            <label className={styles.label}>Full Name</label>
                            <input
                                type="text"
                                name="name"
                                className={styles.input}
                                required
                                value={formData.name}
                                onChange={handleChange}
                                placeholder="ex. John Doe"
                            />
                        </div>

                        <div className={styles.group}>
                            <label className={styles.label}>Email Address</label>
                            <input
                                type="email"
                                name="email"
                                className={styles.input}
                                required
                                value={formData.email}
                                onChange={handleChange}
                                placeholder="ex. john@example.com"
                            />
                        </div>

                        <div className={styles.group}>
                            <label className={styles.label}>Phone Number</label>
                            <input
                                type="tel"
                                name="phone"
                                className={styles.input}
                                value={formData.phone}
                                onChange={handleChange}
                                placeholder="ex. +1 555 000 0000"
                            />
                        </div>

                        <div className={styles.group}>
                            <label className={styles.label}>Tattoo Placement</label>
                            <input
                                type="text"
                                name="placement"
                                className={styles.input}
                                required
                                value={formData.placement}
                                onChange={handleChange}
                                placeholder="ex. Left Inner Forearm"
                            />
                        </div>

                        <div className={styles.group}>
                            <label className={styles.label}>Budget Idea (Optional)</label>
                            <input
                                type="text"
                                name="budget"
                                className={styles.input}
                                value={formData.budget}
                                onChange={handleChange}
                                placeholder="ex. $500 - $1000"
                            />
                        </div>

                        <div className={styles.group}>
                            <label className={styles.label}>Description</label>
                            <textarea
                                name="description"
                                className={styles.textarea}
                                required
                                value={formData.description}
                                onChange={handleChange}
                                placeholder="Describe your creative freedom project idea..."
                            />
                        </div>

                        <div className={styles.submitBtn}>
                            <GoldButton type="submit">REQUEST CONSULTATION</GoldButton>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
};
