import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export default function Planner() {
  const navigate = useNavigate();
  const [mealPlan, setMealPlan] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [swappingId, setSwappingId] = useState(null);
  const [error, setError] = useState('');
  const [selectedRecipe, setSelectedRecipe] = useState(null);
  const fetchActivePlan = async () => {
    try {
      const user = JSON.parse(localStorage.getItem('user'));
      const response = await fetch(`/api/planner/${user.id}`);
      if (response.ok) {
        const data = await response.json();
        setMealPlan(groupEntriesByDay(data.entries));
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    if (!localStorage.getItem('user')) navigate('/login');
    fetchActivePlan();
  }, [navigate]);

  const handleGeneratePlan = async () => {
    setIsLoading(true);
    setError('');
    try {
      const user = JSON.parse(localStorage.getItem('user'));
      const response = await fetch('/api/planner/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id })
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.error || result.message);
      
      window.location.reload(); 
    } catch (err) {
      setError(err.message);
      setIsLoading(false);
    }
  };

  const handleSwapRecipe = async (entryId) => {
    setSwappingId(entryId);
    try {
      const response = await fetch(`/api/planner/swap/${entryId}`, { method: 'PUT' });
      if (response.ok) await fetchActivePlan();
    } catch (error) {
      alert("Failed to swap recipe.");
    } finally {
      setSwappingId(null);
    }
  };

  // Funzione per salvare la spunta "Mangiato" nel Database
  const handleToggleEaten = async (entryId, currentStatus) => {
    try {
      // Aggiorniamo la UI istantaneamente (Ottimismo)
      const updatedPlan = { ...mealPlan };
      for (let day in updatedPlan) {
        const entryIndex = updatedPlan[day].findIndex(e => e.id === entryId);
        if (entryIndex > -1) {
          updatedPlan[day][entryIndex].isLocked = !currentStatus;
        }
      }
      setMealPlan(updatedPlan);

      // Chiamata in background per salvare nel DB
      await fetch(`/api/planner/entry/${entryId}/toggle`, {
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

  return (
    <div className="row justify-content-center mt-4 mb-5">
      <div className="col-12">
        <div className="d-flex flex-column flex-md-row justify-content-between align-md-items-center mb-4 gap-3">
          <h2>📅 Advanced Meal Planner</h2>
          <button 
            onClick={handleGeneratePlan} 
            className="btn btn-primary btn-lg fw-bold shadow-sm"
            disabled={isLoading}
          >
            {isLoading ? '🧠 AI is cooking...' : '✨ Generate Smart Week'}
          </button>
        </div>

        {error && <div className="alert alert-danger shadow-sm"><strong>Oops!</strong> {error}</div>}

        {!mealPlan && !isLoading && !error && (
          <div className="card border-0 shadow-sm text-center p-5 mt-4 bg-body-tertiary">
            <h4 className="text-muted">Your calendar is empty.</h4>
            <p className="text-muted mb-0">Click Generate to create a plan based on your exact macros and pantry!</p>
          </div>
        )}

        {mealPlan && (
          <div className="row g-4 mt-2">
            {Object.keys(mealPlan).sort().map((dateStr) => {
              
              // Calcolo totale giornaliero (solo delle ricette SPUNTATE)
              const consumedCals = mealPlan[dateStr]
                .filter(e => e.isLocked)
                .reduce((sum, e) => sum + (e.recipe.caloriesPerServing || 0), 0);

              const dayEntries = mealPlan[dateStr];
              
              // Totali Pianificati
              const totalCals = dayEntries.reduce((sum, e) => sum + (e.recipe.caloriesPerServing || 0), 0);
              const totalPro = dayEntries.reduce((sum, e) => sum + (e.recipe.proteinGramsPerServing || 0), 0);
              const totalCarbs = dayEntries.reduce((sum, e) => sum + (e.recipe.carbsGramsPerServing || 0), 0);
              const totalFat = dayEntries.reduce((sum, e) => sum + (e.recipe.fatGramsPerServing || 0), 0);

              // Totali Consumati (isLocked = true)
              const eatenCals = dayEntries.filter(e => e.isLocked).reduce((sum, e) => sum + (e.recipe.caloriesPerServing || 0), 0);
              const eatenPro = dayEntries.filter(e => e.isLocked).reduce((sum, e) => sum + (e.recipe.proteinGramsPerServing || 0), 0);
              const eatenCarbs = dayEntries.filter(e => e.isLocked).reduce((sum, e) => sum + (e.recipe.carbsGramsPerServing || 0), 0);
              const eatenFat = dayEntries.filter(e => e.isLocked).reduce((sum, e) => sum + (e.recipe.fatGramsPerServing || 0), 0);

              return (
                <div className="col-md-6 col-xl-4" key={dateStr}>
                  <div className="card shadow-sm h-100 border-0">
                    
                    {/* 2. Sostituisci il card-header con questo */}
                    <div className="card-header bg-dark text-white p-3">
                      <div className="d-flex justify-content-between align-items-center mb-2">
                        <h5 className="card-title text-capitalize mb-0">{formatDate(dateStr)}</h5>
                        <span className="badge bg-primary fs-6">
                          🔥 {eatenCals.toFixed(0)} / {totalCals.toFixed(0)} kcal
                        </span>
                      </div>
                      
                      {/* NUOVA SEZIONE: Macro Totali Giornalieri (Consumati / Totali Generati) */}
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
                          
                          // Se è "isLocked" (Mangiato), applichiamo uno sfondo leggermente grigio e opaco
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
                                {/* La checkbox ORA è collegata al Database! */}
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
{/* --- MODAL DELLA RICETTA (MODULO 3) --- */}
      {selectedRecipe && (
        <div className="modal show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 1050 }}>
          <div className="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable">
            <div className="modal-content border-0 shadow-lg">
              
              <div className="modal-header bg-body-tertiary">
                <h4 className="modal-title fw-bold text-primary">{selectedRecipe.title}</h4>
                <button type="button" className="btn-close" onClick={() => setSelectedRecipe(null)}></button>
              </div>
              
              <div className="modal-body p-4">
                {/* 1. Immagine della ricetta */}
                {selectedRecipe.imageUrl && (
                  <img src={selectedRecipe.imageUrl} alt={selectedRecipe.title} className="img-fluid rounded mb-4 w-100 shadow-sm" style={{ maxHeight: '350px', objectFit: 'cover' }} />
                )}
                
                <div className="row mb-4">
                  {/* 2. LA LISTA DEGLI INGREDIENTI VA QUI (Colonna Sinistra) */}
                  <div className="col-md-6">
                    <h5 className="fw-bold border-bottom pb-2">🛒 Ingredients</h5>
                    <ul className="list-group list-group-flush small">
                      {selectedRecipe.nutritionalInfo?.extendedIngredients?.map((ing, i) => (
                        <li key={i} className="list-group-item px-0 py-1 border-0">
                          • {ing.original}
                        </li>
                      ))}
                      {(!selectedRecipe.nutritionalInfo?.extendedIngredients || selectedRecipe.nutritionalInfo.extendedIngredients.length === 0) && (
                        <li className="list-group-item px-0 py-1 border-0 text-muted fst-italic">Ingredients list not available from source.</li>
                      )}
                    </ul>
                  </div>
                  
                  {/* 3. I Macronutrienti (Colonna Destra) */}
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

                {/* 4. Le Istruzioni */}
                <h5 className="fw-bold border-bottom pb-2">👨‍🍳 Instructions</h5>
                <div 
                  className="recipe-instructions" 
                  style={{ lineHeight: '1.8' }}
                  dangerouslySetInnerHTML={{ __html: selectedRecipe.instructions || '<p class="text-muted fst-italic">No detailed instructions available. Please check the source link.</p>' }}
                />
              </div>

              {/* 5. Il Footer col bottone originale */}
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