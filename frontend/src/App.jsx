import { Routes, Route, Link, useNavigate } from 'react-router-dom';

// Importiamo le nostre pagine
import Dashboard from './pages/Dashboard';
import Profile from './pages/Profile';
import Pantry from './pages/Pantry';
import Planner from './pages/Planner';
import Login from './pages/Login';
import Register from './pages/Register';

function App() {
  const navigate = useNavigate();
  // Controlliamo in tempo reale se l'utente è loggato guardando il localStorage
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
          <Link className="navbar-brand fw-bold" to="/">🍽️ PiattoRicco</Link>
          
          <div className="navbar-collapse">
            <div className="navbar-nav ms-auto">
              <Link className="nav-link" to="/">Dashboard</Link>
              <Link className="nav-link" to="/pantry">Pantry</Link>
              <Link className="nav-link" to="/planner">Meal Planner</Link>
              <Link className="nav-link" to="/profile">Profile</Link>
              
              {/* Logica condizionale per i bottoni di Auth */}
              {isAuthenticated ? (
                <button onClick={handleLogout} className="btn btn-outline-light ms-3 btn-sm">
                  Log Out
                </button>
              ) : (
                <>
                  <Link className="btn btn-outline-light ms-3 btn-sm" to="/login">Log In</Link>
                  <Link className="btn btn-primary ms-2 btn-sm" to="/register">Sign Up</Link>
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
          <Route path="/profile" element={<Profile />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;