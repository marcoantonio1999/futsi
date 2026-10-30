import React from 'react';
import '../src/styles.css';
import {createRoot} from 'react-dom/client';
import {PublicEnrollmentPermit} from '../src/features/enrollments/EnrollmentPermits';
if (!import.meta.env.DEV) throw new Error('Development fixture only');
createRoot(document.getElementById('root')!).render(<PublicEnrollmentPermit invitation="public-test"/>);
