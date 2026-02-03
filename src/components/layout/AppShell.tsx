import React from 'react';
import { Outlet } from 'react-router-dom';
import { Navbar } from './Navbar';
import { BookingSheet } from '../ui/BookingSheet';
import { AboutSheet } from '../ui/AboutSheet';
import { CreativeFreedomSheet } from '../ui/CreativeFreedomSheet';
import { APP_VERSION } from '../../version';

export const AppShell: React.FC = () => {

    return (
        <div style={{ position: 'relative', minHeight: '100vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <Navbar />
            <BookingSheet />
            <AboutSheet />
            <CreativeFreedomSheet />
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
                <p>
                    &copy; {new Date().getFullYear()} Piripi Mason Tattoo. All rights reserved.
                    <span style={{ marginLeft: '0.8rem', opacity: 0.3, fontSize: '0.7em', border: '1px solid #333', padding: '2px 6px', borderRadius: '4px' }}>
                        {APP_VERSION}
                    </span>
                </p>
                {/* Admin Toggle Removed */}
            </footer>
        </div>
    );
};
