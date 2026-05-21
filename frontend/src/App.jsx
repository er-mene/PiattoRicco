import { useState } from 'react';
import { Routes, Route, Link, useNavigate } from 'react-router-dom';

// Importazione delle viste (Pagine) dell'applicazione
import Dashboard from './pages/Dashboard';
import Profile from './pages/Profile';
import Pantry from './pages/Pantry';
import Planner from './pages/Planner';
import Login from './pages/Login';
import Register from './pages/Register';
import Favorites from './pages/Favorites';
import History from './pages/History';

function App() {
  const navigate = useNavigate();
  const [isNavOpen, setIsNavOpen] = useState(false);
  // Verifica reattiva dello stato di autenticazione leggendo il JWT dal LocalStorage
  const isAuthenticated = !!localStorage.getItem('token');

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    navigate('/login');
  };

  return (
    <div>
      <nav className="navbar navbar-expand-lg navbar-dark bg-dark mb-4 shadow-sm">
        <div className="container">
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
              <Link className="nav-link" to="/">Dashboard</Link>
              <Link className="nav-link" to="/pantry">Pantry</Link>
              <Link className="nav-link" to="/planner">Meal Planner</Link>
              <Link className="nav-link" to="/history">History</Link>
              <Link className="nav-link" to="/favorites">Favorites</Link>
              <Link className="nav-link" to="/profile">Profile</Link>

              {/* Rendering condizionale della barra di navigazione basato sullo stato di login */}
              {isAuthenticated ? (
                <button onClick={handleLogout} className="btn btn-outline-light ms-3 btn-sm">
                  Log Out
                </button>
              ) : (
                <>
                  <Link className="btn btn-outline-light ms-lg-3 my-2 my-lg-0 btn-sm" to="/login">Log In</Link>
                  <Link className="btn btn-primary ms-lg-2 mb-2 mb-lg-0 btn-sm" to="/register">Sign Up</Link>
                </>
              )}
            </div>
          </div>
        </div>
      </nav>

      <main className="container">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/pantry" element={<Pantry />} />
          <Route path="/planner" element={<Planner />} />
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