import { createContext } from 'react';

// Shared by the desktop, mobile and inline navigation inside the normal shell.
export const VeronicaOnlyContext = createContext(false);
export const isVeronicaSection = (section: string) => section === 'veronica' || section === 'bulk-veronica' || section === 'connections';
