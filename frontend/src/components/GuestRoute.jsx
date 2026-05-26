import { Navigate } from 'react-router-dom';

/**
 * GuestRoute Wrapper Component
 * Restricts access to unauthenticated users only (guests).
 * If the user is already authenticated (token exists in LocalStorage), they are
 * redirected to the Dashboard page to prevent re-login/re-registration.
 */
export default function GuestRoute({ children }) {
  const token = localStorage.getItem('token');

  if (token) {
    // Redirect authenticated users to /dashboard.
    return <Navigate to="/dashboard" replace />;
  }

  return children;
}
