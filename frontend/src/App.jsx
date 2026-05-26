import { useState } from 'react';
import { Routes, Route, Link, useNavigate, useLocation } from 'react-router-dom';

// Importazione delle viste (pagine) dell'applicazione
import Home from './pages/Home';
import Dashboard from './pages/Dashboard';
import Profile from './pages/Profile';
import Pantry from './pages/Pantry';
import Planner from './pages/Planner';
import Login from './pages/Login';
import Register from './pages/Register';
import Favorites from './pages/Favorites';
import History from './pages/History';
import QuickRecipe from './pages/QuickRecipe';

// Route Guard Wrappers
import ProtectedRoute from './components/ProtectedRoute';
import GuestRoute from './components/GuestRoute';

function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const [isNavOpen, setIsNavOpen] = useState(false);
  // Verifica dello stato di autenticazione controllando il JWT nel LocalStorage
  const isAuthenticated = !!localStorage.getItem('token');
  // Sulla pagina Home, la Hero section occupa l'intero spazio e si attacca alla navbar (nessun margine inferiore).
  const isHome = location.pathname === '/';

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    navigate('/login');
  };

  return (
    <div className="d-flex flex-column min-vh-100">
      {/* Navbar fissata in alto ("sticky") per mantenere la navigazione sempre accessibile durante lo scroll. */}
      <nav className={`navbar navbar-expand-lg navbar-light bg-body border-bottom shadow-sm sticky-top${isHome ? '' : ' mb-4'}`}>
        <div className="container px-3 px-md-4">
          <Link className="navbar-brand fw-bold" to="/"><img src="/assets/logo.png" alt="🍽️ PiattoRicco" height="80" className="d-inline-block align-top" /></Link>

          <button
            className="navbar-toggler"
            type="button"
            onClick={() => setIsNavOpen(!isNavOpen)}
          >
            <span className="navbar-toggler-icon"></span>
          </button>

          <div className={`collapse navbar-collapse ${isNavOpen ? 'show' : ''}`}>
            <div className="navbar-nav ms-auto text-center text-lg-start mt-3 mt-lg-0" onClick={() => setIsNavOpen(false)}>
              <Link className="nav-link" to="/">Home</Link>
              {/* App section links – only visible when the user is logged in */}
              {isAuthenticated && (
                <>
                  <Link className="nav-link" to="/dashboard">Dashboard</Link>
                  <Link className="nav-link" to="/pantry">Pantry</Link>
                  <Link className="nav-link" to="/planner">Meal Planner</Link>
                  <Link className="nav-link" to="/quick-recipe">Quick Recipe</Link>
                  <Link className="nav-link" to="/history">History</Link>
                  <Link className="nav-link" to="/favorites">Favorites</Link>
                  <Link className="nav-link" to="/profile">Profile</Link>
                </>
              )}

              {/* Conditional auth buttons rendering based on authentication state */}
              {isAuthenticated ? (
                <button onClick={handleLogout} className="btn btn-outline-secondary ms-3 btn-sm">
                  Log Out
                </button>
              ) : (
                <>
                  <Link className="btn btn-outline-secondary ms-lg-3 my-2 my-lg-0 btn-sm" to="/login">Log In</Link>
                  <Link className="btn btn-primary ms-lg-2 mb-2 mb-lg-0 btn-sm" to="/register">Sign Up</Link>
                </>
              )}
            </div>
          </div>
        </div>
      </nav>

      {/* Main layout container routing */}
      <main className={`flex-grow-1 ${isHome ? '' : 'container px-3 px-md-4'}`}>
        <Routes>
          {/* Public Route */}
          <Route path="/" element={<Home />} />

          {/* Protected Routes */}
          <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
          <Route path="/pantry" element={<ProtectedRoute><Pantry /></ProtectedRoute>} />
          <Route path="/planner" element={<ProtectedRoute><Planner /></ProtectedRoute>} />
          <Route path="/quick-recipe" element={<ProtectedRoute><QuickRecipe /></ProtectedRoute>} />
          <Route path="/history" element={<ProtectedRoute><History /></ProtectedRoute>} />
          <Route path="/favorites" element={<ProtectedRoute><Favorites /></ProtectedRoute>} />
          <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />

          {/* Guest-Only Routes */}
          <Route path="/login" element={<GuestRoute><Login /></GuestRoute>} />
          <Route path="/register" element={<GuestRoute><Register /></GuestRoute>} />
        </Routes>
      </main>

      {/* Global Footer with AI Disclaimer */}
      <footer className="py-4 mt-5 border-top bg-body-tertiary">
        <div className="container px-3 px-md-4 text-center">
          <p className="text-muted small mb-2">
            © {new Date().getFullYear()} 🍽️ PiattoRicco. All rights reserved.
          </p>
          <p className="mx-auto text-muted mb-0" style={{ fontSize: '0.78rem', maxWidth: '850px', lineHeight: '1.5' }}>
            <span className="fw-bold text-primary">Disclaimer:</span> Meal plans and nutritional calculations are generated using the Google Gemini API. 
            AI-generated recipes, ingredients, instructions, and nutritional values (calories, protein, carbs, fats) are estimates and may contain errors. 
            Please review all ingredients carefully for any potential allergens or intolerance, and consult a qualified healthcare professional or registered dietitian before making significant changes to your diet.
          </p>
        </div>
      </footer>
    </div>
  );
}

export default App;
