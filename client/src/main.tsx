import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './tokens/tokens.css';
import './tokens/tokens-electron.css';
import './index.css';
import { ThemeProvider } from './context/ThemeContext.js';
import App from './App.js';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
);
