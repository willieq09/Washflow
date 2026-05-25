import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Safely handle and suppress benign HMR WebSocket errors/rejections that are expected artifacts of the container proxy environment
if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const isWebSocketRelated = reason && (
      (reason instanceof Error && reason.message?.includes('WebSocket')) ||
      (typeof reason === 'string' && reason.includes('WebSocket')) ||
      (reason.message && typeof reason.message === 'string' && reason.message.includes('WebSocket')) ||
      (reason.stack && typeof reason.stack === 'string' && reason.stack.includes('WebSocket'))
    );
    if (isWebSocketRelated) {
      event.preventDefault();
      console.warn('Suppressed expected environment HMR WebSocket rejection:', reason);
    }
  });

  window.addEventListener('error', (event) => {
    const isWebSocketRelated = event.message?.includes('WebSocket') || 
                              event.filename?.includes('vite') ||
                              event.message?.includes('HMR');
    if (isWebSocketRelated) {
      event.preventDefault();
      console.warn('Suppressed expected environment HMR WebSocket error:', event.message);
    }
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

