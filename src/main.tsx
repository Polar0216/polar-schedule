import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './app/App';
import { StoreProvider } from './app/Store';
import { SyncProvider } from './features/sync/SyncProvider';
import './styles.css';
import { startPwa } from './features/pwa/pwaState';

createRoot(document.getElementById('root')!).render(<StrictMode><StoreProvider><SyncProvider><App /></SyncProvider></StoreProvider></StrictMode>);

startPwa();
