import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchWithAuth } from '../utils/api';

export default function Pantry() {
  const navigate = useNavigate();
  // Array locale che contiene tutti gli ingredienti salvati in dispensa
  const [items, setItems] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  // Stati per la gestione della Dispensa e dell'interfaccia utente
  const [suggestions, setSuggestions] = useState([]); // Risultati da AI autocomplete
  const [showSuggestions, setShowSuggestions] = useState(false); // Visibilità dropdown
  const [isSearching, setIsSearching] = useState(false); // Loader autocomplete
  const [selectedIngredient, setSelectedIngredient] = useState(null); // Ingrediente selezionato validato

  // Stato per il form di aggiunta di un nuovo ingrediente
  const [formData, setFormData] = useState({
    name: '',
    quantity: '',
    unit: ''
  });
  // Stati per la gestione della modifica "inline" sulla tabella (quantità e unità)
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ quantity: '', unit: '' });
  
  // Caricamento iniziale dei dati della dispensa dal database
  useEffect(() => {
    const userString = localStorage.getItem('user');
    if (!userString) return navigate('/login');

    const fetchPantry = async () => {
      try {
        const user = JSON.parse(userString);
        const response = await fetchWithAuth(`/api/pantry/${user.id}`);
        if (!response.ok) throw new Error('Failed to fetch pantry');
        setItems(await response.json());
      } catch (err) {
        setError('Could not load pantry items.');
      }
    };
    fetchPantry();
  }, [navigate]);

  useEffect(() => {
    let active = true;

    // Disattiva la ricerca se la query è inferiore a 2 caratteri
    if (formData.name.trim().length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      setIsSearching(false);
      return;
    }

    // Inizializza il timer di debounce (300ms)
    const delayDebounceFn = setTimeout(async () => {
      setIsSearching(true);
      try {
        const response = await fetchWithAuth(`/api/ingredients/autocomplete?query=${formData.name}`);
        if (response.ok && active) {
          const data = await response.json();
          setSuggestions(data);
          setShowSuggestions(true);

          // Cerca una corrispondenza esatta case-insensitive nei suggerimenti restituiti
          const match = data.find(s => s.name.toLowerCase() === formData.name.trim().toLowerCase());
          if (match) {
            setSelectedIngredient(match);
          }
        }
      } catch (error) {
        if (active) {
          console.error("Autocomplete failed", error);
        }
      } finally {
        if (active) {
          setIsSearching(false);
        }
      }
    }, 300);

    // Cleanup: Annulla il timer precedente e invalida le richieste in corso
    return () => {
      active = false;
      clearTimeout(delayDebounceFn);
    };
  }, [formData.name]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData({ ...formData, [name]: value });
    if (name === 'name') {
      // Cerca una corrispondenza esatta case-insensitive nei suggerimenti correnti
      const match = suggestions.find(s => s.name.toLowerCase() === value.trim().toLowerCase());
      if (match) {
        setSelectedIngredient(match);
      } else {
        setSelectedIngredient(null);
      }
    }
  };

  // Gestore della selezione di un suggerimento dal menu a tendina
  const handleSelectSuggestion = (suggestion) => {
    setFormData({ ...formData, name: suggestion.name });
    setSelectedIngredient(suggestion);
    setShowSuggestions(false); // Nasconde i suggerimenti dopo la selezione
  };

  const handleAddItem = async (e) => {
    e.preventDefault();
    const ingredientName = formData.name.trim();
    if (!ingredientName) return;

    // Forza l'accettazione solo di ingredienti dall'autocomplete
    const isNameValid = selectedIngredient && selectedIngredient.name.toLowerCase() === ingredientName.toLowerCase();
    if (!isNameValid) {
      setError('Please select a valid ingredient from the suggestions list.');
      return;
    }

    setIsLoading(true);
    setError('');
    setShowSuggestions(false); // Nasconde forzatamente la tendina in fase di salvataggio

    try {
      const user = JSON.parse(localStorage.getItem('user'));
      const response = await fetchWithAuth('/api/pantry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          name: selectedIngredient.name, // Utilizza il nome validato
          // Gestione dei valori nulli per quantità e unità non specificate
          quantity: formData.quantity === '' ? null : formData.quantity,
          unit: formData.unit === '' ? null : formData.unit
        })
      });

      if (!response.ok) throw new Error('Failed to add ingredient');

      // Aggiorna lo stato UI immettendo il nuovo oggetto restituito dall'API all'inizio dell'array
      const addedItem = await response.json();
      setItems([addedItem, ...items]);
      
      // Svuota solo il campo nome per consentire inserimenti in batch veloci
      setFormData({ ...formData, name: '' }); 
      setSelectedIngredient(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteItem = async (itemId) => {
    try {
      const response = await fetchWithAuth(`/api/pantry/${itemId}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Failed to delete item');
      setItems(items.filter(item => item.id !== itemId));
    } catch (err) {
      setError('Failed to delete item.');
    }
  };
  const startEditing = (item) => {
    setEditingId(item.id);
    setEditForm({ quantity: item.quantity || '', unit: item.unit || '' });
  };

  const handleSaveEdit = async (itemId) => {
    try {
      const response = await fetchWithAuth(`/api/pantry/${itemId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quantity: editForm.quantity === '' ? null : editForm.quantity,
          unit: editForm.unit === '' ? null : editForm.unit
        })
      });
      if (!response.ok) throw new Error('Failed to update');
      const updatedItem = await response.json();
      
      // Aggiorna localmente l'elemento modificato per evitare di ricaricare l'intera lista
      setItems(items.map(item => item.id === itemId ? updatedItem : item));
      setEditingId(null);
    } catch (err) {
      setError('Failed to update item.');
    }
  };
  
  const isNameValid = !!(selectedIngredient && selectedIngredient.name.toLowerCase() === formData.name.trim().toLowerCase());

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
              {/* Contenitore Relativo per il posizionamento corretto del menu a tendina Absolute */}
              <div className="col-12 col-md-5 position-relative">
                <input 
                  type="text" 
                  className={`form-control ${isNameValid ? 'is-valid' : ''}`} 
                  name="name"
                  placeholder="Ingredient (e.g. Chicken)" 
                  value={formData.name}
                  onChange={handleChange}
                  autoComplete="off" // Disabilita l'autocompletamento di default del browser
                  disabled={isLoading}
                  required
                />
                
                {/* Spinner di caricamento o spunta di validità */}
                {isSearching ? (
                  <div className="position-absolute top-50 end-0 translate-middle-y pe-3" style={{ zIndex: 10 }}>
                    <span className="spinner-border spinner-border-sm text-primary" role="status" aria-hidden="true"></span>
                  </div>
                ) : (
                  isNameValid && (
                    <div className="position-absolute top-50 end-0 translate-middle-y pe-3 text-success fw-bold" style={{ zIndex: 10 }} title="Ingredient validly selected">
                      ✓
                    </div>
                  )
                )}

                {/* Messaggio di avviso se la query è valida ma non selezionata (posizionato in modo assoluto per evitare shifting) */}
                {!isNameValid && formData.name.trim().length >= 2 && (
                  <div className="text-warning small position-absolute start-0 ps-1" style={{ fontSize: '0.82rem', top: '100%', zIndex: 10 }}>
                    ⚠️ Choose a suggestion from the list
                  </div>
                )}

                {/* Renderizzazione della tendina con i suggerimenti AI (sfondo solido per overlay mobile) */}
                {showSuggestions && suggestions.length > 0 && (
                  <ul className="list-group position-absolute w-100 shadow mt-1 bg-dark border" style={{ zIndex: 1000, maxHeight: '200px', overflowY: 'auto' }}>
                    {suggestions.map((suggestion) => (
                      <li 
                        key={suggestion.id} 
                        className="list-group-item list-group-item-action text-capitalize bg-dark text-light"
                        style={{ cursor: 'pointer' }}
                        onClick={() => handleSelectSuggestion(suggestion)}
                      >
                        {suggestion.name}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              
              {/* Campo Input per la Quantità */}
              <div className="col-12 col-sm-6 col-md-3">
                <input 
                  type="number" 
                  className="form-control" 
                  name="quantity"
                  placeholder="Quantity" // Etichetta placeholder
                  min="0.1"
                  step="0.1"
                  value={formData.quantity}
                  onChange={handleChange}
                  disabled={isLoading}
                  /* Nota: il campo 'required' è stato volutamente rimosso per supportare l'inserimento senza quantità */
                />
              </div>

              {/* Dropdown per la Selezione dell'Unità di Misura */}
              <div className="col-12 col-sm-6 col-md-2">
                <select 
                  className={`form-select ${formData.unit === '' ? 'text-muted' : ''}`} 
                  name="unit"
                  value={formData.unit}
                  onChange={handleChange}
                  disabled={isLoading}
                >
                  <option value="">Unit</option> {/* Valore neutro (null) */}
                  <option value="pieces">pcs</option>
                  <option value="g">g</option>
                  <option value="kg">kg</option>
                  <option value="ml">ml</option>
                  <option value="l">l</option>
                  <option value="tbsp">tbsp</option>
                  <option value="tsp">tsp</option>
                </select>
              </div>
              <div className="col-12 col-md-2">
                <button 
                  type="submit" 
                  className="btn btn-primary w-100 fw-bold"
                  disabled={isLoading || !isNameValid}
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
                        
                        {/* Colonna: Visualizzazione e Modifica di Quantità/Unità */}
                        <td>
                          {editingId === item.id ? (
                            <div className="d-flex gap-2">
                              <input type="number" className="form-control form-control-sm" placeholder="Qty" value={editForm.quantity} onChange={(e) => setEditForm({...editForm, quantity: e.target.value})} style={{width: '70px'}} />
                              <select className="form-select form-select-sm" value={editForm.unit} onChange={(e) => setEditForm({...editForm, unit: e.target.value})} style={{width: '80px'}}>
                                <option value="">Unit</option>
                                <option value="pieces">pcs</option>
                                <option value="g">g</option>
                                <option value="kg">kg</option>
                                <option value="ml">ml</option>
                                <option value="l">l</option>
                                <option value="tbsp">tbsp</option>
                                <option value="tsp">tsp</option>
                              </select>
                            </div>
                          ) : (
                            `${item.quantity || ''} ${item.unit || ''}`.trim() || '-'
                          )}
                        </td>
                        
                        {/* Colonna: Pulsanti di Azione (Modifica, Salva, Rimuovi) */}
                        <td className="text-end">
                          {editingId === item.id ? (
                            <button type="button" className="btn btn-sm btn-success me-2" onClick={() => handleSaveEdit(item.id)}>Save</button>
                          ) : (
                            <button type="button" className="btn btn-sm btn-outline-primary me-2" onClick={() => startEditing(item)}>Edit</button>
                          )}
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