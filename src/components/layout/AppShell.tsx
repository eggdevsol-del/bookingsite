import React from 'react';
import { Outlet } from 'react-router-dom';
import { Navbar } from './Navbar';
import { BookingSheet } from '../ui/BookingSheet';

export const AppShell: React.FC = () => {

    return (
        <div style={{ position: 'relative', minHeight: '100vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <Navbar />
            <BookingSheet />
            <main style={{ flex: 1 }}>
                <Outlet />
            </main>
            <footer style={{
                padding: '2rem',
                textAlign: 'center',
                borderTop: '1px solid #222',
                background: '#050505',
                color: '#444',
                fontSize: '0.8rem'
            }}>
                <p>&copy; {new Date().getFullYear()} Piripi Mason Tattoo. All rights reserved.</p>
                {/* Admin Toggle Removed */}
            </footer>
        </div>
    );
};
