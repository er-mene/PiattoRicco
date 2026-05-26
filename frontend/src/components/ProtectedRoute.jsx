import { Navigate, useLocation } from 'react-router-dom';

/**
 * ProtectedRoute Wrapper Component
 * Restricts access to authenticated users only (based on standard LocalStorage JWT existence).
 * If the user is unauthenticated, redirects to the log-in page and passes the attempted
 * location path in state so the user can be automatically redirected back upon logging in.
 */
export default function ProtectedRoute({ children }) {
  const token = localStorage.getItem('token');
  const location = useLocation();

  if (!token) {
    // Redirect unauthenticated users to /login, saving their location in state.
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return children;
}
