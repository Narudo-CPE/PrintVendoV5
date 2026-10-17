import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import { AppRouter } from './AppRouter.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <AppRouter />
    </ErrorBoundary>
  </StrictMode>,
);

