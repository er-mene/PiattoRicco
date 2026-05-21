/**
 * Wrapper dell'API Fetch nativa.
 * Inietta automaticamente l'header di Autorizzazione (Bearer Token) in tutte le richieste
 * in uscita verso il backend, garantendo l'autenticazione delle sessioni.
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
  
  // Gestione globale degli errori di autenticazione:
  // Se il backend restituisce 401 (Token Scaduto o Non Valido),
  // l'utente viene forzatamente disconnesso e rimandato alla pagina di login.
  if (response.status === 401) {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = '/login'; // Reindirizzamento al Login
  }

  return response;
}
