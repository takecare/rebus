import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.js';
import './styles.css';

// The keyboard covers the layout on iOS instead of resizing it; track the
// visible viewport ourselves. SPEC 6.3.
function trackViewport(): void {
  const vv = window.visualViewport;
  const set = () => {
    const height = vv?.height ?? window.innerHeight;
    document.documentElement.style.setProperty('--app-height', `${height}px`);
  };
  set();
  vv?.addEventListener('resize', set);
  vv?.addEventListener('scroll', set);
  window.addEventListener('orientationchange', set);
}
trackViewport();

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
