import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchWithAuth } from '../utils/api';

export default function Planner() {
  const navigate = useNavigate();
  // Stato principale del piano alimentare settimanale
  const [mealPlan, setMealPlan] = useState(null);
  
  // Stati per la gestione del caricamento e degli errori
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [progressMessage, setProgressMessage] = useState(''); // Messaggi di progresso SSE
  const [isStrictMode, setIsStrictMode] = useState(false); // Modalità Strict Pantry
  
  // Stati per le interazioni UI (swap e visualizzazione dettagli)
  const [swappingId, setSwappingId] = useState(null);
  const [selectedRecipe, setSelectedRecipe] = useState(null);
  


  /**
   * Recupera il piano alimentare attivo dell'utente dal backend.
   * Raggruppa in automatico i risultati per data per facilitare il rendering.
   */
  const fetchActivePlan = async () => {
    try {
      const user = JSON.parse(localStorage.getItem('user'));
      const response = await fetchWithAuth(`/api/planner/${user.id}`);
      if (response.ok) {
        const data = await response.json();
        setMealPlan(groupEntriesByDay(data.entries));
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    // Reindirizza al login se l'utente non è in sessione
    if (!localStorage.getItem('user')) navigate('/login');
    // Carica il piano appena il componente viene montato
    fetchActivePlan();
  }, [navigate]);

  const handleGeneratePlan = async () => {
      setIsLoading(true);
      setError('');
      setProgressMessage('');
      try {
        const response = await fetchWithAuth('/api/planner/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isStrictPantryMode: isStrictMode })
        });

        const contentType = response.headers.get('Content-Type') || '';
        if (contentType.includes('application/json')) {
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || result.message);
          await fetchActivePlan();
          setIsLoading(false);
          return;
        }

        // Configurazione per leggere lo stream di eventi Server-Sent Events (SSE)
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let idx;
          while ((idx = buffer.indexOf('\n\n')) !== -1) {
            const event = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);

            const dataLine = event.split('\n').find(l => l.startsWith('data: '));
            if (!dataLine) continue;

            const data = JSON.parse(dataLine.slice(6));
            if (data.type === 'status') {
              setProgressMessage(data.message);
            } else if (data.type === 'complete') {
              await fetchActivePlan();
              setIsLoading(false);
              return;
            } else if (data.type === 'error') {
              throw new Error(data.message);
            }
          }
        }

        await fetchActivePlan();
        setIsLoading(false);
      } catch (err) {
        setError(err.message);
        setIsLoading(false);
      }
    };
  const handleSwapRecipe = async (entryId) => {
    setSwappingId(entryId); // Mostra il loader sul singolo bottone
    try {
      const response = await fetchWithAuth(`/api/planner/swap/${entryId}`, { method: 'PUT' });
      if (response.ok) {
        await fetchActivePlan(); // Ricarica il piano aggiornato
      } else {
        const result = await response.json();
        alert(result.error || "Failed to swap recipe.");
      }
    } catch (error) {
      alert("Failed to swap recipe.");
    } finally {
      setSwappingId(null); // Rimuove il loader
    }
  };

  /**
   * Cambia lo stato "Mangiato" (isLocked) di un pasto.
   * Utilizza l'approccio dell'Aggiornamento Ottimistico (Optimistic UI Update)
   * per garantire un'esperienza utente immediata, mentre salva i dati in background.
   */
  const handleToggleEaten = async (entryId, currentStatus) => {
    try {
      // 1. Aggiornamento Ottimistico della UI
      const updatedPlan = { ...mealPlan };
      for (let day in updatedPlan) {
        const entryIndex = updatedPlan[day].findIndex(e => e.id === entryId);
        if (entryIndex > -1) {
          updatedPlan[day][entryIndex].isLocked = !currentStatus;
        }
      }
      setMealPlan(updatedPlan);

      // 2. Chiamata API asincrona in background per la persistenza su database
      await fetchWithAuth(`/api/planner/entry/${entryId}/toggle`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isLocked: !currentStatus })
      });
    } catch (error) {
      console.error("Failed to toggle status");
    }
  };

  const groupEntriesByDay = (entries) => {
    return entries.reduce((acc, entry) => {
      const dateStr = new Date(entry.day).toISOString().split('T')[0];
      if (!acc[dateStr]) acc[dateStr] = [];
      acc[dateStr].push(entry);
      return acc;
    }, {});
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  };

  // Calcolo delle ricette uniche per mostrare un avviso se il piano è troppo ripetitivo
  let uniqueRecipesCount = 0;
  if (mealPlan) {
    const titles = new Set();
    Object.values(mealPlan).forEach(dayMeals => {
      dayMeals.forEach(entry => titles.add(entry.recipe.title));
    });
    uniqueRecipesCount = titles.size;
  }
  
  // Mostra l'avviso se il piano ha generato 7 o meno ricette uniche in tutta la settimana
  const showRepetitiveWarning = mealPlan && uniqueRecipesCount <= 7;

  return (
    <div className="row justify-content-center mt-4 mb-5">
      <div className="col-12">
        <div className="d-flex flex-column flex-md-row justify-content-between align-items-md-center mb-5 gap-3 p-4 rounded-4 shadow-lg" 
            style={{ background: '#1e1e1e', border: '1px solid #333' }}>
          <h2 className="mb-0 text-white fw-bold">📅 Advanced Planner</h2>
          
          <div className="d-flex align-items-center gap-3 flex-wrap">
            <div 
              className={`d-flex align-items-center gap-3 px-3 py-2 rounded-pill shadow-sm`}
              style={{ 
                cursor: isLoading ? 'not-allowed' : 'pointer', 
                transition: 'all 0.3s ease',
                background: isStrictMode ? 'linear-gradient(45deg, #198754, #20c997)' : 'rgba(255,255,255,0.05)',
                border: `1px solid ${isStrictMode ? 'transparent' : 'rgba(255,255,255,0.1)'}`
              }}
              onClick={() => !isLoading && setIsStrictMode(!isStrictMode)}
              title={isStrictMode ? "AI will strictly use your pantry ingredients." : "AI can use extra ingredients if necessary."}
            >
              <div className="form-check form-switch mb-0 d-flex align-items-center" style={{ minHeight: 'auto', paddingLeft: 0 }}>
                <input 
                  className="form-check-input ms-0 me-2 mt-0" 
                  type="checkbox" 
                  role="switch" 
                  checked={isStrictMode}
                  readOnly
                  disabled={isLoading}
                  style={{ cursor: 'inherit', width: '2rem', height: '1rem' }}
                />
              </div>
              <div className="d-flex flex-column text-white" style={{ lineHeight: '1.1' }}>
                <span className="fw-bold" style={{ fontSize: '0.85rem' }}>Strict Pantry Mode</span>
                <span style={{ fontSize: '0.7rem', opacity: 0.9 }}>{isStrictMode ? 'Only your ingredients' : 'Allows extra ingredients'}</span>
              </div>
            </div>

            <button 
              className="btn btn-outline-success border-2 rounded-pill fw-bold px-4" 
              onClick={handleGeneratePlan}
              disabled={isLoading}
              style={{ letterSpacing: '0.5px' }}
            >
              {isLoading ? (
                <><span className="spinner-border spinner-border-sm me-2"></span>{progressMessage || 'Cooking...'}</>
              ) : (
                '✨ GENERATE PLAN'
              )}
            </button>
          </div>
        </div>

        {error && <div className="alert alert-danger shadow-sm mt-4"><strong>Oops!</strong> {error}</div>}

        {showRepetitiveWarning && !isLoading && !error && (
          <div className="alert alert-warning shadow-sm border-0 rounded-4 d-flex align-items-center gap-3 mt-4 mb-0" style={{ background: 'linear-gradient(to right, #fff3cd, #ffecb5)' }}>
            <span className="fs-2 lh-1">⚠️</span>
            <div>
              <strong className="text-dark">Limited Variety Detected!</strong> 
              <p className="text-dark opacity-75 mb-0 small mt-1">
                Because you have very few ingredients in your pantry, we had to repeat some recipes to accurately hit your nutritional goals. 
                <strong> Add more ingredients to your pantry</strong> to unlock a much more diverse meal plan!
              </p>
            </div>
          </div>
        )}

        {!mealPlan && !isLoading && !error && (
          <div className="card border-0 shadow-sm text-center p-5 mt-4 bg-body-tertiary">
            <h4 className="text-muted">Your calendar is empty.</h4>
            <p className="text-muted mb-0">Click Generate to create a plan based on your exact macros and pantry!</p>
          </div>
        )}

        {mealPlan && (
          <div className="row g-4 mt-2">
            {Object.keys(mealPlan).sort().map((dateStr) => {
              
              // Calcola il totale delle calorie unicamente per le ricette consumate (spuntate)
              const consumedCals = mealPlan[dateStr]
                .filter(e => e.isLocked)
                .reduce((sum, e) => sum + (e.recipe.caloriesPerServing || 0), 0);

              const dayEntries = mealPlan[dateStr];
              
              // Calcola i totali pianificati per l'intera giornata (Goal)
              const totalCals = dayEntries.reduce((sum, e) => sum + (e.recipe.caloriesPerServing || 0), 0);
              const totalPro = dayEntries.reduce((sum, e) => sum + (e.recipe.proteinGramsPerServing || 0), 0);
              const totalCarbs = dayEntries.reduce((sum, e) => sum + (e.recipe.carbsGramsPerServing || 0), 0);
              const totalFat = dayEntries.reduce((sum, e) => sum + (e.recipe.fatGramsPerServing || 0), 0);

              // Calcola i totali reali consumati dall'utente (Actual)
              const eatenCals = dayEntries.filter(e => e.isLocked).reduce((sum, e) => sum + (e.recipe.caloriesPerServing || 0), 0);
              const eatenPro = dayEntries.filter(e => e.isLocked).reduce((sum, e) => sum + (e.recipe.proteinGramsPerServing || 0), 0);
              const eatenCarbs = dayEntries.filter(e => e.isLocked).reduce((sum, e) => sum + (e.recipe.carbsGramsPerServing || 0), 0);
              const eatenFat = dayEntries.filter(e => e.isLocked).reduce((sum, e) => sum + (e.recipe.fatGramsPerServing || 0), 0);

              return (
                <div className="col-md-6 col-xl-4" key={dateStr}>
                  <div className="card shadow-sm h-100 border-0">
                    
                    {/* Intestazione della Card Giornaliera */}
                    <div className="card-header bg-dark text-white p-3">
                      <div className="d-flex justify-content-between align-items-center mb-2">
                        <h5 className="card-title text-capitalize mb-0">{formatDate(dateStr)}</h5>
                        <span className="badge bg-primary fs-6">
                          🔥 {eatenCals.toFixed(0)} / {totalCals.toFixed(0)} kcal
                        </span>
                      </div>
                      
                      {/* Riepilogo Progressi Macronutrienti: Mostra il rapporto Consumato / Generato */}
                      <div className="d-flex justify-content-between text-light opacity-75" style={{ fontSize: '0.8rem' }}>
                        <div>
                          <strong>Pro:</strong> {mealPlan[dateStr].filter(e=>e.isLocked).reduce((sum, e) => sum + (e.recipe.proteinGramsPerServing || 0), 0).toFixed(0)} / 
                          {mealPlan[dateStr].reduce((sum, e) => sum + (e.recipe.proteinGramsPerServing || 0), 0).toFixed(0)}g
                        </div>
                        <div>
                          <strong>Carbs:</strong> {mealPlan[dateStr].filter(e=>e.isLocked).reduce((sum, e) => sum + (e.recipe.carbsGramsPerServing || 0), 0).toFixed(0)} / 
                          {mealPlan[dateStr].reduce((sum, e) => sum + (e.recipe.carbsGramsPerServing || 0), 0).toFixed(0)}g
                        </div>
                        <div>
                          <strong>Fat:</strong> {mealPlan[dateStr].filter(e=>e.isLocked).reduce((sum, e) => sum + (e.recipe.fatGramsPerServing || 0), 0).toFixed(0)} / 
                          {mealPlan[dateStr].reduce((sum, e) => sum + (e.recipe.fatGramsPerServing || 0), 0).toFixed(0)}g
                        </div>
                      </div>
                    </div>

                    <div className="card-body p-0">
                      <ul className="list-group list-group-flush">
                        {mealPlan[dateStr].map((entry) => {
                          
                          const info = entry.recipe.nutritionalInfo || {};
                          const missed = info.missedIngredients || [];
                          
                          // Stile dinamico: i pasti consumati appaiono disabilitati (grigi e opachi)
                          const liClass = entry.isLocked ? 'list-group-item p-3 position-relative bg-body-tertiary opacity-50' : 'list-group-item p-3 position-relative';
                          
                          return (
                            <li key={entry.id} className={liClass} style={{ transition: 'all 0.3s' }}>
                              
                              <div className="d-flex justify-content-between align-items-start mb-2">
                                <span className={`badge ${
                                  entry.mealType === 'BREAKFAST' ? 'bg-info text-dark' : 
                                  entry.mealType === 'LUNCH' ? 'bg-success' : 
                                  entry.mealType === 'DINNER' ? 'bg-primary' : 'bg-warning text-dark'
                                }`}>
                                  {entry.mealType}
                                </span>

                                <button 
                                  className="btn btn-sm btn-outline-secondary py-0 px-2"
                                  onClick={() => handleSwapRecipe(entry.id)}
                                  disabled={swappingId === entry.id || entry.isLocked}
                                  title="Change Recipe"
                                >
                                  {swappingId === entry.id ? '...' : '🔄 Swap'}
                                </button>
                              </div>
                              
                              <div className="d-flex align-items-center gap-2 mb-2">
                                {/* Checkbox interattiva legata allo stato del database */}
                                <input 
                                  className="form-check-input mt-0 fs-5" 
                                  type="checkbox" 
                                  checked={entry.isLocked}
                                  onChange={() => handleToggleEaten(entry.id, entry.isLocked)}
                                  title="Mark as Eaten" 
                                  style={{ cursor: 'pointer' }}
                                />
                                <h6 
                                  className={`mb-0 fw-bold lh-sm ${entry.isLocked ? 'text-decoration-line-through text-muted' : 'text-primary'}`} 
                                  style={{ flex: 1, cursor: 'pointer' }}
                                  onClick={() => setSelectedRecipe(entry.recipe)}
                                >
                                  {entry.recipe.title}
                                </h6>
                              </div>

                              <div className="d-flex gap-2 mb-2" style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#666' }}>
                                <span>🔥 {entry.recipe.caloriesPerServing?.toFixed(0) || 0} kcal</span>
                                <span>P: {entry.recipe.proteinGramsPerServing?.toFixed(0) || 0}g</span>
                                <span>C: {entry.recipe.carbsGramsPerServing?.toFixed(0) || 0}g</span>
                                <span>F: {entry.recipe.fatGramsPerServing?.toFixed(0) || 0}g</span>
                              </div>

                              {!entry.isLocked && missed.length > 0 && (
                                <div className="mt-2 p-2 bg-body-tertiary border rounded" style={{ fontSize: '0.75rem' }}>
                                  <strong className="text-danger d-block mb-1">🛒 Missing Ingredients:</strong>
                                  <span className="text-muted text-capitalize">{missed.join(', ')}</span>
                                </div>
                              )}
                              
                            </li>
                          )
                        })}
                      </ul>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
      {/* Modale di Dettaglio Ricetta */}
      {selectedRecipe && (
        <div className="modal show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 1050 }}>
          <div className="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable">
            <div className="modal-content border-0 shadow-lg">
              
              <div className="modal-header bg-body-tertiary">
                <div className="d-flex align-items-center gap-2">
                  <h4 className="modal-title fw-bold text-primary mb-0">{selectedRecipe.title}</h4>
                  
                  {/* Badge AI Chef: Visibile esclusivamente per le ricette generate da Gemini */}
                  {selectedRecipe.sourceType === 'AI_GENERATED' && (
                    <span className="badge text-dark border border-warning shadow-sm" style={{ background: 'linear-gradient(45deg, #FFD700, #FFA500)' }}>
                      ✨ AI Chef Recipe
                    </span>
                  )}
                </div>
                
                <button type="button" className="btn-close" onClick={() => setSelectedRecipe(null)}></button>
              </div>
              
                <div className="modal-body p-4">
                  {selectedRecipe.imageUrl && (
                  <img src={selectedRecipe.imageUrl} alt={selectedRecipe.title} className="img-fluid rounded mb-4 w-100 shadow-sm" style={{ maxHeight: '350px', objectFit: 'cover' }} />
                )}
                
                <div className="row mb-4">
                  <div className="col-md-6">
                    <h5 className="fw-bold border-bottom pb-2">🛒 Ingredients</h5>
                    <ul className="list-group list-group-flush small">
                      {selectedRecipe.nutritionalInfo?.ingredientsList?.map((ing, i) => (
                        <li key={i} className="list-group-item px-0 py-1 border-0">
                          <span>
                            <strong className="text-primary">{ing.amount} {ing.unit}</strong> <span className="text-capitalize">{ing.name}</span>
                          </span>
                        </li>
                      ))}

                      {/* Fallback in assenza di ingredienti */}
                      {(!selectedRecipe.nutritionalInfo?.ingredientsList || selectedRecipe.nutritionalInfo.ingredientsList.length === 0) && (
                        <li className="list-group-item px-0 py-1 border-0 text-muted fst-italic">Ingredients list not available.</li>
                      )}
                      
                    </ul>
                  </div>
                  
                  <div className="col-md-6">
                    <h5 className="fw-bold border-bottom pb-2">📊 Macros per Serving</h5>
                    <div className="d-flex flex-column gap-2 small">
                      <div>🔥 <strong>Calories:</strong> {selectedRecipe.caloriesPerServing?.toFixed(0)} kcal</div>
                      <div>🥩 <strong>Protein:</strong> {selectedRecipe.proteinGramsPerServing?.toFixed(0)} g</div>
                      <div>🌾 <strong>Carbs:</strong> {selectedRecipe.carbsGramsPerServing?.toFixed(0)} g</div>
                      <div>🥑 <strong>Fat:</strong> {selectedRecipe.fatGramsPerServing?.toFixed(0)} g</div>
                    </div>
                  </div>
                </div>

                <h5 className="fw-bold border-bottom pb-2">👨‍🍳 Instructions</h5>
                <div 
                  className="recipe-instructions" 
                  style={{ lineHeight: '1.8' }}
                  dangerouslySetInnerHTML={{ __html: selectedRecipe.instructions || '<p class="text-muted fst-italic">No detailed instructions available. Please check the source link.</p>' }}
                />
              </div>

              <div className="modal-footer bg-body-tertiary">
                {selectedRecipe.sourceUrl && (
                  <a href={selectedRecipe.sourceUrl} target="_blank" rel="noreferrer" className="btn btn-outline-primary me-auto">
                    View Original Source
                  </a>
                )}
                <button type="button" className="btn btn-secondary fw-bold px-4" onClick={() => setSelectedRecipe(null)}>Close</button>
              </div>

            </div>
          </div>
        </div>
      )}
    </div>
  );
}