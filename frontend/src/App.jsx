import { useState } from 'react';
import { Routes, Route, Link, useNavigate, useLocation } from 'react-router-dom';

// Importazione delle viste (Pagine) dell'applicazione
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
  // Verifica reattiva dello stato di autenticazione leggendo il JWT dal LocalStorage
  const isAuthenticated = !!localStorage.getItem('token');
  // On the home page the hero is full-bleed and sits flush under the navbar (no extra gap).
  const isHome = location.pathname === '/';

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    navigate('/login');
  };

  return (
    <div>
      {/*
        navbar-light + bg-body: matches the warm cream kitchen theme (see custom.css).
        sticky-top keeps navigation visible while scrolling long pages like Planner.
      */}
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

              {/* Rendering condizionale della barra di navigazione basato sullo stato di login */}
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

      {/*
        Home owns its own .container per section for a full-bleed cookbook layout.
        All other routes use Bootstrap's standard .container on <main>.
      */}
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
