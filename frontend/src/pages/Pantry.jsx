import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchWithAuth } from '../utils/api';

export default function Pantry() {
  const navigate = useNavigate();
  // Array di stato locale che memorizza l'intera lista degli ingredienti in dispensa
  const [items, setItems] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  // Stati per la gestione della logica di autocompletamento (AI) della Dispensa
  const [suggestions, setSuggestions] = useState([]); // Elenco dei risultati di autocompletamento (AI)
  const [showSuggestions, setShowSuggestions] = useState(false); // Visibilità del menu a tendina
  const [isSearching, setIsSearching] = useState(false); // Indicatore di caricamento della ricerca
  const [selectedIngredient, setSelectedIngredient] = useState(null); // Oggetto ingrediente validato e selezionato
  const skipSearchRef = useRef(false);

  // Stato del form per l'aggiunta di un nuovo ingrediente
  const [formData, setFormData] = useState({
    ingredientName: '',
    quantity: '',
    unit: ''
  });
  // Stati per la modifica rapida in linea (inline editing) per aggiornare quantità e unità di misura
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ quantity: '', unit: '' });
  
  // Recupera il contenuto della dispensa dal database al caricamento del componente
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

    if (skipSearchRef.current) {
      skipSearchRef.current = false;
      return;
    }

    // Disabilita la ricerca se l'input dell'utente è troppo corto (meno di 2 caratteri)
    if (formData.ingredientName.trim().length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      setIsSearching(false);
      return;
    }

    // Inizializza il timer di "debounce" (300ms) per limitare le chiamate API durante la digitazione veloce
    const delayDebounceFn = setTimeout(async () => {
      setIsSearching(true);
      try {
        const response = await fetchWithAuth(`/api/ingredients/autocomplete?query=${formData.ingredientName}`);
        if (response.ok && active) {
          const data = await response.json();
          setSuggestions(data);
          setShowSuggestions(true);

          // Cerca una corrispondenza esatta (case-insensitive) tra i suggerimenti recuperati per validare l'input
          const match = data.find(s => s.name.toLowerCase() === formData.ingredientName.trim().toLowerCase());
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

    // Funzione di cleanup: invalida le richieste in corso e resetta il timer al variare dell'input
    return () => {
      active = false;
      clearTimeout(delayDebounceFn);
    };
  }, [formData.ingredientName]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData({ ...formData, [name]: value });
    if (name === 'ingredientName') {
      skipSearchRef.current = false;
      // Verifica la presenza di una corrispondenza esatta a ogni singolo cambiamento dell'input
      const match = suggestions.find(s => s.name.toLowerCase() === value.trim().toLowerCase());
      if (match) {
        setSelectedIngredient(match);
      } else {
        setSelectedIngredient(null);
      }
    }
  };

  // Gestore per la selezione di un suggerimento dal menu a tendina
  const handleSelectSuggestion = (suggestion) => {
    skipSearchRef.current = true;
    setFormData({ ...formData, ingredientName: suggestion.name });
    setSelectedIngredient(suggestion);
    setShowSuggestions(false); // Nasconde il menu a tendina dopo aver selezionato un elemento
  };

  const handleAddItem = async (e) => {
    e.preventDefault();
    const ingredientName = formData.ingredientName.trim();
    if (!ingredientName) return;

    // Forza l'utente a selezionare esclusivamente ingredienti suggeriti e validati dall'AI
    const isNameValid = selectedIngredient && selectedIngredient.name.toLowerCase() === ingredientName.toLowerCase();
    if (!isNameValid) {
      setError('Please select a valid ingredient from the suggestions list.');
      return;
    }

    // Prevenzione Duplicati: blocca l'aggiunta se l'ingrediente è già nella lista locale
    const isDuplicate = items.some(item => item.ingredient.name.toLowerCase() === selectedIngredient.name.toLowerCase());
    if (isDuplicate) {
      setError('This ingredient is already in your pantry.');
      return;
    }

    setIsLoading(true);
    setError('');
    setShowSuggestions(false); // Forza la chiusura della tendina durante il salvataggio

    try {
      const user = JSON.parse(localStorage.getItem('user'));
      const response = await fetchWithAuth('/api/pantry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          name: selectedIngredient.name, // Usa il nome canonico validato dall'AI
          // Annulla stringhe vuote in null per rispettare la validazione del database
          quantity: formData.quantity === '' ? null : formData.quantity,
          unit: formData.unit === '' ? null : formData.unit
        })
      });

      if (!response.ok) throw new Error('Failed to add ingredient');

      // Inserisce il nuovo oggetto ingrediente restituito dal server in cima allo stato locale
      const addedItem = await response.json();
      setItems([addedItem, ...items]);
      
      // Svuota unicamente il campo del nome per permettere un inserimento rapido in sequenza
      setFormData({ ...formData, ingredientName: '' }); 
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
      
      // Aggiorna localmente l'elemento modificato per non dover ricaricare l'intera pagina
      setItems(items.map(item => item.id === itemId ? updatedItem : item));
      setEditingId(null);
    } catch (err) {
      setError('Failed to update item.');
    }
  };
  
  const isNameValid = !!(selectedIngredient && selectedIngredient.name.toLowerCase() === formData.ingredientName.trim().toLowerCase());

  return (
    <div className="row justify-content-center mt-4">
      <div className="col-12">
        <h2 className="mb-4">🧺 My Pantry</h2>
        
        <div className="card shadow-sm border-0 mb-4">
          <div className="card-body p-4">
            <p className="text-muted mb-4">
              Add the ingredients you have. Use the auto-suggestions to ensure perfect recipe matching!
            </p>

            {error && <div className="alert alert-danger">{error}</div>}

            <form onSubmit={handleAddItem} className="row g-2 mb-4 align-items-center">
              {/* Contenitore relativo per posizionare correttamente il menu a tendina (dropdown) */}
              <div className="col-12 col-md-5 position-relative">
                <input 
                  type="text" 
                  className={`form-control ${isNameValid ? 'is-valid' : ''}`} 
                  name="ingredientName"
                  placeholder="Ingredient (e.g. Chicken)" 
                  value={formData.ingredientName}
                  onChange={handleChange}
                  autoComplete="one-time-code" // Disabilita l'autocompletamento nativo del browser per usare quello custom AI
                  disabled={isLoading}
                  required
                />
                
                {/* Indicatore di caricamento (spinner) o segno di spunta per validazione completata */}
                {isSearching ? (
                  <div className="position-absolute top-50 end-0 translate-middle-y pe-3" style={{ zIndex: 10 }}>
                    <span className="spinner-border spinner-border-sm text-primary" role="status" aria-hidden="true"></span>
                  </div>
                ) : (
                  isNameValid && (
                    <div className="position-absolute top-50 end-0 translate-middle-y pe-3 text-success fw-bold" style={{ zIndex: 10 }} title="Validated ingredient name">
                      ✓
                    </div>
                  )
                )}

                {/* Messaggio di avviso visibile se l'utente digita ma non seleziona nulla dalla lista */}
                {!isNameValid && formData.ingredientName.trim().length >= 2 && (
                  <div className="text-warning small position-absolute start-0 ps-1" style={{ fontSize: '0.82rem', top: '100%', zIndex: 10 }}>
                    ⚠️ Choose a suggestion from the list
                  </div>
                )}

                {/* Lista dei suggerimenti AI (menu a tendina sovrapposto) */}
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
              
              {/* Campo input per la quantità */}
              <div className="col-12 col-sm-6 col-md-3">
                <input 
                  type="number" 
                  className="form-control" 
                  name="quantity"
                  placeholder="Quantity"
                  min="0.1"
                  step="0.1"
                  value={formData.quantity}
                  onChange={handleChange}
                  disabled={isLoading}
                  /* Il vincolo 'required' è rimosso per consentire inserimenti senza una quantità specificata */
                />
              </div>

              {/* Menu a tendina per l'unità di misura */}
              <div className="col-12 col-sm-6 col-md-2">
                <select 
                  className={`form-select ${formData.unit === '' ? 'text-muted' : ''}`} 
                  name="unit"
                  value={formData.unit}
                  onChange={handleChange}
                  disabled={isLoading}
                >
                  <option value="">Unit</option> {/* Opzione nulla di default */}
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
                        
                        {/* Visualizzazione e Modifica in linea dei campi Quantità e Unità di Misura */}
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
                        
                        {/* Bottoni per le Azioni (Modifica, Salva, Elimina) */}
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