import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';

export default function Login() {
  const navigate = useNavigate();
  // useLocation ci permette di leggere i dati passati da altre pagine
  const location = useLocation(); 
  
  // Se arriviamo dal Register, qui ci sarà il nostro messaggio
  const successMessage = location.state?.successMessage;

  const [formData, setFormData] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const response = await fetch('http://localhost:5001/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Login failed');
      }

      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));

      navigate('/'); 
      
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="row justify-content-center mt-5">
      <div className="col-md-6 col-lg-5">
        <div className="card shadow-sm border-0">
          <div className="card-body p-5">
            <h2 className="text-center mb-4">Welcome Back</h2>
            
            {/* Se c'è un messaggio di successo dal Register, lo mostriamo in verde */}
            {successMessage && (
              <div className="alert alert-success text-center fw-bold">
                {successMessage}
              </div>
            )}

            {/* Se c'è un errore di login, lo mostriamo in rosso */}
            {error && <div className="alert alert-danger">{error}</div>}

            <form onSubmit={handleSubmit}>
              <div className="mb-3">
                <label className="form-label fw-bold">Email address</label>
                <input 
                  type="email" 
                  className="form-control form-control-lg" 
                  name="email" 
                  value={formData.email} 
                  onChange={handleChange} 
                  required 
                />
              </div>
              
              <div className="mb-4">
                <label className="form-label fw-bold">Password</label>
                <input 
                  type="password" 
                  className="form-control form-control-lg" 
                  name="password" 
                  value={formData.password} 
                  onChange={handleChange} 
                  required 
                />
              </div>

              <button disabled={isLoading} type="submit" className="btn btn-primary w-100 btn-lg fw-bold mb-3">
                {isLoading ? 'Logging in...' : 'Log In'}
              </button>
            </form>

            <p className="text-center text-muted mt-3 mb-0">
              Don't have an account yet? <Link to="/register" className="text-decoration-none">Sign up</Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}