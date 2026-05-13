// A thin wrapper around native fetch that automatically injects the Authorization header
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
  
  // Optional: Global handling for 401 Unauthorized (e.g. token expired)
  if (response.status === 401) {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = '/login'; // Redirect to login
  }

  return response;
}
