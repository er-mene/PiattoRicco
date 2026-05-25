/**
 * Native Fetch API wrapper.
 * Automatically injects the Authorization header (Bearer Token) into all outgoing
 * backend requests to secure authenticated sessions.
 */
export async function fetchWithAuth(url, options = {}) {
  const token = localStorage.getItem('token');
  
  const headers = {
    ...options.headers,
    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
  };

  const finalOptions = {
    ...options,
    headers
  };

  const response = await fetch(url, finalOptions);
  
  // Global auth failure handling:
  // If the backend returns 401 (Unauthorized/Expired Token),
  // clear credentials and force redirect to login.
  if (response.status === 401) {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = '/login'; // Redirect to login
  }

  return response;
}
