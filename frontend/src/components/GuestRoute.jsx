import { Navigate } from 'react-router-dom';

export default function GuestRoute({ children }) {
  const token = localStorage.getItem('token');

  if (token) {
    // Redirect authenticated users to /dashboard.
    return <Navigate to="/dashboard" replace />;
  }

  return children;
}
