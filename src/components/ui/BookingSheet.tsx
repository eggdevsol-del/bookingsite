import React, { useState, useEffect } from 'react';

// Declare fbq for TypeScript
declare global {
    interface Window { fbq: (...args: any[]) => void; }
}
import { X } from 'lucide-react';
import { GoldButton } from './GoldButton';
import { useUIStore } from '../../store/uiStore';
import styles from './BookingSheet.module.css';

export const BookingSheet: React.FC = () => {
    const { isBookingOpen, closeBooking } = useUIStore();

    const [formData, setFormData] = useState({
        name: '',
        email: '',
        phone: '',
        placement: '',
        description: '',
        budget: ''
    });

    const [isSubmitting, setIsSubmitting] = useState(false);
    const [submitStatus, setSubmitStatus] = useState<'idle' | 'success' | 'error'>('idle');

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmitting(true);
        setSubmitStatus('idle');

        try {
            const response = await fetch("https://api.web3forms.com/submit", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Accept: "application/json",
                },
                body: JSON.stringify({
                    access_key: "c1389843-5af5-4f04-acd2-6558a4a1c8e4", // Web3Forms Access Key
                    subject: `Inquiry Tattoo: ${formData.name || 'New Client'} - ${formData.placement}`,
                    from_name: formData.name,
                    replyto: formData.email,
                    message: `*** NEW TATTOO INQUIRY ***\n\n-- CLIENT DETAILS --\nName: ${formData.name}\nPhone: ${formData.phone || 'Not provided'}\nEmail: ${formData.email}\n\n-- PROJECT INFO --\nPlacement: ${formData.placement}\nBudget: ${formData.budget || 'Not provided'}\n\n-- DESCRIPTION --\n${formData.description}`
                }),
            });

            const result = await response.json();

            if (result.success) {
                // Meta Pixel: Track consultation form submission as a Lead ONLY on success
                if (typeof window.fbq === 'function') {
                    window.fbq('track', 'Lead', {
                        content_name: 'Consultation Request',
                        content_category: 'Tattoo Booking',
                    });
                }

                setSubmitStatus('success');
                // Auto-close after 3 seconds on success
                setTimeout(() => {
                    closeBooking();
                    setSubmitStatus('idle');
                    setFormData({ name: '', email: '', phone: '', placement: '', description: '', budget: '' });
                }, 3000);
            } else {
                console.error("Web3Forms error", result);
                setSubmitStatus('error');
            }
        } catch (error) {
            console.error("Submission failed", error);
            setSubmitStatus('error');
        } finally {
            setIsSubmitting(false);
        }
    };

    // Prevent background scroll when open + track Meta Pixel ViewContent
    useEffect(() => {
        if (isBookingOpen) {
            document.body.style.overflow = 'hidden';
            // Meta Pixel: Track booking form opened
            if (typeof window.fbq === 'function') {
                window.fbq('track', 'ViewContent', { content_name: 'Booking Form' });
            }
        } else {
            document.body.style.overflow = 'auto';
        }
        return () => { document.body.style.overflow = 'auto'; };
    }, [isBookingOpen]);

    return (
        <div className={`${styles.overlay} ${isBookingOpen ? styles.open : ''}`}>
            <div className={styles.sheet}>
                <button className={styles.closeBtn} onClick={closeBooking}>
                    <X size={24} />
                </button>

                <div className={styles.content}>
                    <h2 className={styles.title}>APPOINTMENT INQUIRY</h2>
                    <p className={styles.subtitle}>SECURE YOUR LEGACY</p>

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
                                placeholder="Describe your idea in detail..."
                            />
                        </div>

                        <div className={styles.submitBtn} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <GoldButton type="submit" disabled={isSubmitting}>
                                {isSubmitting ? 'SENDING INQUIRY...' : submitStatus === 'success' ? 'INQUIRY SENT!' : 'REQUEST CONSULTATION'}
                            </GoldButton>

                            {submitStatus === 'error' && (
                                <p style={{ color: '#ff4444', fontSize: '14px', textAlign: 'center', margin: 0 }}>
                                    Failed to send. Please try again.
                                </p>
                            )}
                            {submitStatus === 'success' && (
                                <p style={{ color: '#44ff44', fontSize: '14px', textAlign: 'center', margin: 0 }}>
                                    We've received your request! Check your email shortly.
                                </p>
                            )}
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
};
