import React, { useState } from 'react';
import { Edit2, Check, X } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { useContentStore } from '../../store/contentStore';
import styles from './EditableImage.module.css';

interface EditableImageProps {
    contentKey: string;
    defaultSrc: string;
    alt: string;
    className?: string;
    style?: React.CSSProperties;
}

export const EditableImage: React.FC<EditableImageProps> = ({
    contentKey,
    defaultSrc,
    alt,
    className,
    style,
}) => {
    const isAdmin = useAuthStore((state) => state.isAdmin);
    const currentSrc = useContentStore((state) => state.getImage(contentKey, defaultSrc));
    const setImage = useContentStore((state) => state.setImage);

    const [isEditing, setIsEditing] = useState(false);
    const [tempUrl, setTempUrl] = useState(currentSrc);

    const handleSave = () => {
        setImage(contentKey, tempUrl);
        setIsEditing(false);
    };

    const handleCancel = () => {
        setTempUrl(currentSrc);
        setIsEditing(false);
    };

    // Simple extension check. For robust apps, use a dedicated field or MIME check.
    const isVideo = currentSrc.toLowerCase().match(/\.(mp4|mov|webm)$/);

    return (
        <div className={`${styles.wrapper} ${className}`} style={style}>
            {isVideo ? (
                <video
                    src={currentSrc}
                    className={styles.image}
                    autoPlay
                    loop
                    muted
                    playsInline
                />
            ) : (
                <img src={currentSrc} alt={alt} className={styles.image} />
            )}

            {isAdmin && !isEditing && (
                <button
                    className={styles.editBtn}
                    onClick={() => setIsEditing(true)}
                    title="Edit Content"
                >
                    <Edit2 size={16} />
                </button>
            )}

            {isEditing && (
                <div className={styles.editorOverlay}>
                    <input
                        type="text"
                        value={tempUrl}
                        onChange={(e) => setTempUrl(e.target.value)}
                        className={styles.input}
                        placeholder="Enter Image or Video URL"
                        autoFocus
                    />
                    <div className={styles.actions}>
                        <button className={styles.saveBtn} onClick={handleSave}><Check size={16} /></button>
                        <button className={styles.cancelBtn} onClick={handleCancel}><X size={16} /></button>
                    </div>
                </div>
            )}
        </div>
    );
};
