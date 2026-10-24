import React from 'react';
import {createRoot} from 'react-dom/client';
import '../src/styles.css';
import {EnrollmentDashboard} from '../src/features/enrollments/PlayerEnrollment';
if (!import.meta.env.DEV) throw new Error('Development fixture only');
createRoot(document.getElementById('root')!).render(<EnrollmentDashboard token="fictional" restricted userId={999999} onLogout={()=>{}}/>);
