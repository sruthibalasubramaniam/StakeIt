import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import { AppRoutes } from './router';
import { AppErrorBoundary } from './router/AppErrorBoundary';

/**
 * Provider order matters:
 *   ToastProvider  — anything below may raise a toast
 *   AuthProvider   — the session gates every route
 *   BrowserRouter  — routing last so guards can use navigation hooks
 */
export default function App() {
  return (
    <AppErrorBoundary>
      <ToastProvider>
        <AuthProvider>
          <BrowserRouter>
            <AppRoutes />
          </BrowserRouter>
        </AuthProvider>
      </ToastProvider>
    </AppErrorBoundary>
  );
}
