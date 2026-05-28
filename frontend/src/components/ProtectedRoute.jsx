import { Navigate, useLocation } from 'react-router-dom';

export default function ProtectedRoute({ children }) {
  const token = localStorage.getItem('token');
  const location = useLocation();

  if (!token) {
    // Redirect unauthenticated users to /login, saving their location in state.
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return children;
}
