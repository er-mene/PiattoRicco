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
    <div>
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
      <main className={isHome ? '' : 'container px-3 px-md-4'}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/pantry" element={<Pantry />} />
          <Route path="/planner" element={<Planner />} />
          <Route path="/quick-recipe" element={<QuickRecipe />} />
          <Route path="/history" element={<History />} />
          <Route path="/favorites" element={<Favorites />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;
