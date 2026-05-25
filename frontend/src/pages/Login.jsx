import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';

export default function Login() {
  const navigate = useNavigate();
  // Hook to intercept location state (e.g. success messages) passed from other pages
  const location = useLocation(); 
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
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: formData.email.trim().toLowerCase(),
          password: formData.password
        })
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
            
            {/* Success Alert: Shown after a successful registration redirection */}
            {successMessage && (
              <div className="alert alert-success text-center fw-bold">
                {successMessage}
              </div>
            )}

            {/* Error Alert: Shown if credentials are invalid or login fails */}
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