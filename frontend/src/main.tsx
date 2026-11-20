import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initTheme } from './ui/theme';
import './ui/theme.css';

initTheme();

const root = document.getElementById('root');
if (!root) throw new Error('В index.html нет элемента #root');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
