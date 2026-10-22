import React from 'react';
import {createRoot} from 'react-dom/client';
import '../src/styles.css';
import {BulkTemplatesPanel} from '../src/features/voice-agent/BulkTemplatesPanel';
if (!import.meta.env.DEV) throw new Error('Development fixture only');
createRoot(document.getElementById('root')!).render(<main style={{maxWidth:1280,margin:'auto',padding:12,minWidth:0}}><BulkTemplatesPanel token="fictional" kind="veronica"/></main>);
