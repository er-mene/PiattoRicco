import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

export default function Register() {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({ email: '', password: '', confirmPassword: '' });
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (formData.password !== formData.confirmPassword) {
      return setError("Passwords don't match");
    }

    setIsLoading(true);

    try {
      
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: formData.email, password: formData.password })
      });

      const data = await response.json();


      if (!response.ok) {
        throw new Error(data.error || 'Registration failed');
      }

      // Naviga verso la vista di Login inoltrando un messaggio di benvenuto dinamico
      navigate('/login', { 
        state: { successMessage: 'Account created successfully! Welcome to Pantry Chef. Please log in.' } 
      });
      
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
            <h2 className="text-center mb-4">Create Account</h2>
            
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
              
              <div className="mb-3">
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

              <div className="mb-4">
                <label className="form-label fw-bold">Confirm Password</label>
                <input 
                  type="password" 
                  className="form-control form-control-lg" 
                  name="confirmPassword" 
                  value={formData.confirmPassword} 
                  onChange={handleChange} 
                  required 
                />
              </div>

              <button disabled={isLoading} type="submit" className="btn btn-primary w-100 btn-lg fw-bold mb-3">
                {isLoading ? 'Creating account...' : 'Sign Up'}
              </button>
            </form>

            <p className="text-center text-muted mt-3 mb-0">
              Already have an account? <Link to="/login" className="text-decoration-none">Log in here</Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}