import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export default function Pantry() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  // Stati per l'Autocomplete
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isSearching, setIsSearching] = useState(false);

  const [formData, setFormData] = useState({
    name: '',
    quantity: 1,
    unit: 'pieces'
  });

  // Caricamento della dispensa iniziale
  useEffect(() => {
    const userString = localStorage.getItem('user');
    if (!userString) return navigate('/login');

    const fetchPantry = async () => {
      try {
        const user = JSON.parse(userString);
        const response = await fetch(`http://localhost:5001/api/pantry/${user.id}`);
        if (!response.ok) throw new Error('Failed to fetch pantry');
        setItems(await response.json());
      } catch (err) {
        setError('Could not load pantry items.');
      }
    };
    fetchPantry();
  }, [navigate]);

  // Effetto magico (Debounce) per l'Autocomplete
  useEffect(() => {
    // Se la stringa è troppo corta, chiudiamo i suggerimenti
    if (formData.name.trim().length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    // Se stiamo digitando, impostiamo un timer di 300ms
    const delayDebounceFn = setTimeout(async () => {
      setIsSearching(true);
      try {
        const response = await fetch(`http://localhost:5001/api/ingredients/autocomplete?query=${formData.name}`);
        if (response.ok) {
          const data = await response.json();
          setSuggestions(data);
          setShowSuggestions(true);
        }
      } catch (error) {
        console.error("Autocomplete failed", error);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    // Se l'utente digita di nuovo prima dei 300ms, cancelliamo il timer precedente
    return () => clearTimeout(delayDebounceFn);
  }, [formData.name]);

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  // Quando l'utente clicca un suggerimento dalla tendina
  const handleSelectSuggestion = (suggestionName) => {
    setFormData({ ...formData, name: suggestionName });
    setShowSuggestions(false); // Chiudiamo la tendina
  };

  const handleAddItem = async (e) => {
    e.preventDefault();
    if (!formData.name.trim()) return;

    setIsLoading(true);
    setError('');
    setShowSuggestions(false); // Sicurezza: chiudi tendina al submit

    try {
      const user = JSON.parse(localStorage.getItem('user'));
      const response = await fetch('http://localhost:5001/api/pantry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          name: formData.name, // Questo ora sarà il nome ufficiale di Spoonacular!
          quantity: formData.quantity,
          unit: formData.unit
        })
      });

      if (!response.ok) throw new Error('Failed to add ingredient');

      const addedItem = await response.json();
      setItems([addedItem, ...items]);
      setFormData({ ...formData, name: '' }); 
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteItem = async (itemId) => {
    try {
      const response = await fetch(`http://localhost:5001/api/pantry/${itemId}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Failed to delete item');
      setItems(items.filter(item => item.id !== itemId));
    } catch (err) {
      setError('Failed to delete item.');
    }
  };

  return (
    <div className="row justify-content-center mt-4">
      <div className="col-md-10 col-lg-8">
        <h2 className="mb-4">🧺 My Pantry</h2>
        
        <div className="card shadow-sm border-0 mb-4">
          <div className="card-body p-4">
            <p className="text-muted mb-4">
              Add the ingredients you have. Use the auto-suggestions to ensure perfect recipe matching!
            </p>

            {error && <div className="alert alert-danger">{error}</div>}

            <form onSubmit={handleAddItem} className="row g-2 mb-4 align-items-center">
              {/* Contenitore Relativo per posizionare il menu a tendina */}
              <div className="col-md-5 position-relative">
                <input 
                  type="text" 
                  className="form-control" 
                  name="name"
                  placeholder="Ingredient (e.g. Chicken)" 
                  value={formData.name}
                  onChange={handleChange}
                  autoComplete="off" // Disabilitiamo l'autocomplete nativo del browser
                  disabled={isLoading}
                  required
                />
                
                {/* Loader per la ricerca in tempo reale */}
                {isSearching && (
                  <div className="position-absolute top-50 end-0 translate-middle-y pe-3">
                    <span className="spinner-border spinner-border-sm text-primary" role="status" aria-hidden="true"></span>
                  </div>
                )}

                {/* Il Menu a tendina dei suggerimenti */}
                {showSuggestions && suggestions.length > 0 && (
                  <ul className="list-group position-absolute w-100 shadow mt-1" style={{ zIndex: 1000, maxHeight: '200px', overflowY: 'auto' }}>
                    {suggestions.map((suggestion) => (
                      <li 
                        key={suggestion.id} 
                        className="list-group-item list-group-item-action text-capitalize"
                        style={{ cursor: 'pointer' }}
                        onClick={() => handleSelectSuggestion(suggestion.name)}
                      >
                        {/* Se Spoonacular manda l'immagine, potremmo persino farla vedere! */}
                        {suggestion.name}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              
              <div className="col-md-3">
                <input 
                  type="number" 
                  className="form-control" 
                  name="quantity"
                  min="0.1"
                  step="0.1"
                  value={formData.quantity}
                  onChange={handleChange}
                  disabled={isLoading}
                  required
                />
              </div>
              <div className="col-md-2">
                <select 
                  className="form-select" 
                  name="unit"
                  value={formData.unit}
                  onChange={handleChange}
                  disabled={isLoading}
                >
                  <option value="pieces">pcs</option>
                  <option value="g">g</option>
                  <option value="kg">kg</option>
                  <option value="ml">ml</option>
                  <option value="l">l</option>
                  <option value="tbsp">tbsp</option>
                  <option value="tsp">tsp</option>
                </select>
              </div>
              <div className="col-md-2">
                <button 
                  type="submit" 
                  className="btn btn-primary w-100 fw-bold"
                  disabled={isLoading || !formData.name.trim()}
                >
                  {isLoading ? '...' : 'Add'}
                </button>
              </div>
            </form>

            <div className="table-responsive">
              <table className="table table-hover align-middle">
                <thead className="table-light">
                  <tr>
                    <th>Ingredient</th>
                    <th>Quantity</th>
                    <th className="text-end">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {items.length === 0 ? (
                    <tr>
                      <td colSpan="3" className="text-center text-muted fst-italic py-3">
                        Your pantry is empty.
                      </td>
                    </tr>
                  ) : (
                    items.map((item) => (
                      <tr key={item.id}>
                        <td className="fw-medium text-capitalize">
                          {item.ingredient.name}
                        </td>
                        <td>
                          {item.quantity} {item.unit}
                        </td>
                        <td className="text-end">
                          <button 
                            type="button" 
                            className="btn btn-sm btn-outline-danger"
                            onClick={() => handleDeleteItem(item.id)}
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}