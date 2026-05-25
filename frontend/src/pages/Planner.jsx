import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchWithAuth } from '../utils/api';

export default function Planner() {
  const navigate = useNavigate();
  // State variables for weekly meal plan schedule
  const [mealPlan, setMealPlan] = useState(null);
  
  // Loading, error, and UI mode state variables
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [progressMessage, setProgressMessage] = useState(''); // SSE progress messages
  const [isStrictMode, setIsStrictMode] = useState(false); // Strict Pantry Mode flag
  
  // UI interactive state variables (swap loading states, modal detail views, and active day)
  const [swappingId, setSwappingId] = useState(null);
  const [selectedRecipe, setSelectedRecipe] = useState(null);
  const [activeDay, setActiveDay] = useState(null); // Active tab date for responsive mobile views


  /**
   * Fetches the user's active weekly meal plan from the database.
   * Automatically groups entries by date for rendering layout blocks.
   */
  const fetchActivePlan = async () => {
    try {
      const user = JSON.parse(localStorage.getItem('user'));
      const response = await fetchWithAuth(`/api/planner/${user.id}`);
      if (response.ok) {
        const data = await response.json();
        const grouped = groupEntriesByDay(data.entries);
        setMealPlan(grouped);
        
        // Set default active tab on mobile view (today if in plan, or first day otherwise)
        const sortedDates = Object.keys(grouped).sort();
        if (sortedDates.length > 0) {
          const todayStr = new Date().toISOString().split('T')[0];
          if (sortedDates.includes(todayStr)) {
            setActiveDay(todayStr);
          } else {
            setActiveDay(sortedDates[0]);
          }
        }
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

        // Configure stream reader for Server-Sent Events (SSE)
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
    setSwappingId(entryId); // Enable loading state for individual recipe button
    try {
      const response = await fetchWithAuth(`/api/planner/swap/${entryId}`, { method: 'PUT' });
      if (response.ok) {
        await fetchActivePlan(); // Refresh plan data
      } else {
        const result = await response.json();
        alert(result.error || "Failed to swap recipe.");
      }
    } catch (error) {
      alert("Failed to swap recipe.");
    } finally {
      setSwappingId(null); // Disable loading state
    }
  };

  /**
   * Toggles completion status (isLocked) of a meal entry.
   * Utilizes optimistic UI updates to ensure immediate visual feedback while saving changes.
   */
  const handleToggleEaten = async (entryId, currentStatus) => {
    try {
      // 1. Optimistic UI update
      const updatedPlan = { ...mealPlan };
      for (let day in updatedPlan) {
        const entryIndex = updatedPlan[day].findIndex(e => e.id === entryId);
        if (entryIndex > -1) {
          updatedPlan[day][entryIndex].isLocked = !currentStatus;
        }
      }
      setMealPlan(updatedPlan);

      // 2. Persistent API update in background
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

  // Compute count of unique pantry items used.
  // Warning triggers if AI keeps recommending same minimal base ingredients due to a sparse pantry.
  let uniqueUsedIngredientsCount = 0;
  let totalMealsCount = 0;
  if (mealPlan) {
    const usedIngredientsSet = new Set();
    Object.values(mealPlan).forEach(dayMeals => {
      totalMealsCount += dayMeals.length;
      dayMeals.forEach(entry => {
        const used = entry.recipe.nutritionalInfo?.usedIngredients || [];
        used.forEach(ing => usedIngredientsSet.add(ing.toLowerCase()));
      });
    });
    uniqueUsedIngredientsCount = usedIngredientsSet.size;
  }
  
  // Warn if weekly menu relies on 3 or fewer unique pantry ingredients
  const showRepetitiveWarning = mealPlan && totalMealsCount > 0 && uniqueUsedIngredientsCount <= 3;

  return (
    <div className="row justify-content-center mt-4 mb-5">
      <div className="col-12">
        <div className="d-flex flex-column flex-md-row justify-content-between align-items-md-center mb-5 gap-3 p-4 rounded-4 shadow-lg" 
            style={{ background: '#1e1e1e', border: '1px solid #333' }}>
          <h2 className="mb-0 text-white fw-bold">📅 Meal Planner</h2>
          
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
              <strong className="text-dark">Limited Pantry Detected! (Only {uniqueUsedIngredientsCount} ingredients used)</strong> 
              <p className="text-dark opacity-75 mb-0 small mt-1">
                Because you have very few ingredients in your pantry, almost all your meals revolve around the same base ingredients. 
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
          <>
            {/* Horizontal Day Selector tabs (Visible on Mobile only) */}
            <div className="d-block d-md-none mb-4 overflow-x-auto hide-scrollbar p-2 bg-dark rounded-4 shadow-sm">
              <ul className="nav nav-pills flex-nowrap gap-2">
                {Object.keys(mealPlan).sort().map((dateStr) => {
                  const isActive = activeDay === dateStr;
                  const dateObj = new Date(dateStr);
                  const dayNum = dateObj.getDate();
                  const weekday = dateObj.toLocaleDateString('en-US', { weekday: 'short' });
                  return (
                    <li className="nav-item" key={dateStr}>
                      <button
                        className={`nav-link text-nowrap py-1 px-3 rounded-pill text-center d-flex flex-column align-items-center ${isActive ? 'active' : ''}`}
                        style={{ minWidth: '70px' }}
                        onClick={() => setActiveDay(dateStr)}
                      >
                        <span className="small text-uppercase opacity-75" style={{ fontSize: '0.62rem', letterSpacing: '0.5px' }}>{weekday}</span>
                        <span className="fw-bold fs-5">{dayNum}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className="row g-4 mt-2 justify-content-center">
              {Object.keys(mealPlan).sort().map((dateStr) => {
                
                // Calculate total calories consumed (checked meals)
                const consumedCals = mealPlan[dateStr]
                  .filter(e => e.isLocked)
                  .reduce((sum, e) => sum + (e.recipe.caloriesPerServing || 0), 0);

                const dayEntries = mealPlan[dateStr];
                
                // Calculate planned targets for the full day (Goal)
                const totalCals = dayEntries.reduce((sum, e) => sum + (e.recipe.caloriesPerServing || 0), 0);
                const totalPro = dayEntries.reduce((sum, e) => sum + (e.recipe.proteinGramsPerServing || 0), 0);
                const totalCarbs = dayEntries.reduce((sum, e) => sum + (e.recipe.carbsGramsPerServing || 0), 0);
                const totalFat = dayEntries.reduce((sum, e) => sum + (e.recipe.fatGramsPerServing || 0), 0);

                // Calculate actual totals consumed (Actual)
                const eatenCals = dayEntries.filter(e => e.isLocked).reduce((sum, e) => sum + (e.recipe.caloriesPerServing || 0), 0);
                const eatenPro = dayEntries.filter(e => e.isLocked).reduce((sum, e) => sum + (e.recipe.proteinGramsPerServing || 0), 0);
                const eatenCarbs = dayEntries.filter(e => e.isLocked).reduce((sum, e) => sum + (e.recipe.carbsGramsPerServing || 0), 0);
                const eatenFat = dayEntries.filter(e => e.isLocked).reduce((sum, e) => sum + (e.recipe.fatGramsPerServing || 0), 0);

                const isSelectedOnMobile = activeDay === dateStr;

                return (
                  <div className={`col-md-6 col-lg-4 col-xxl-3 ${isSelectedOnMobile ? 'd-block' : 'd-none d-md-block'}`} key={dateStr}>
                    <div className="card shadow-sm h-100 border-0 hover-card">
                    
                    {/* Daily Card Header */}
                    <div className="card-header bg-dark text-white p-3">
                      <div className="d-flex justify-content-between align-items-center mb-2">
                        <h5 className="card-title text-capitalize mb-0">{formatDate(dateStr)}</h5>
                        <span className="badge bg-primary fs-6">
                          🔥 {eatenCals.toFixed(0)} / {totalCals.toFixed(0)} kcal
                        </span>
                      </div>
                      
                      {/* Macronutrient Progress Summary: Shows the Consumed / Generated ratio */}
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
                          
                          // Dynamic styling: completed/eaten meals appear disabled (gray and opaque)
                          const liClass = entry.isLocked ? 'list-group-item p-3 position-relative bg-body-tertiary opacity-50' : 'list-group-item p-3 position-relative';
                          
                          return (
                            <li key={entry.id} className={liClass} style={{ transition: 'all 0.3s' }}>
                              
                              <div className="d-flex justify-content-between align-items-center mb-2 gap-2">
                                <div className="d-flex flex-wrap gap-1 align-items-center" style={{ flex: 1, minWidth: 0 }}>
                                  <span className={`badge ${
                                    entry.mealType === 'BREAKFAST' ? 'bg-info text-dark' : 
                                    entry.mealType === 'LUNCH' ? 'bg-success' : 
                                    entry.mealType === 'DINNER' ? 'bg-primary' : 'bg-warning text-dark'
                                  }`}>
                                    {entry.mealType}
                                  </span>
                                  {(entry.recipe.nutritionalInfo?.tags || []).map((tag, i) => (
                                    <span key={i} className="badge badge-sage" style={{ fontSize: '0.65rem', padding: '2px 6px' }}>
                                      {tag}
                                    </span>
                                  ))}
                                </div>

                                <button 
                                  className="btn btn-sm btn-outline-secondary py-0 px-2 flex-shrink-0"
                                  onClick={() => handleSwapRecipe(entry.id)}
                                  disabled={swappingId === entry.id || entry.isLocked}
                                  title="Change Recipe"
                                >
                                  {swappingId === entry.id ? '...' : '🔄 Swap'}
                                </button>
                              </div>
                              
                              <div className="d-flex align-items-center gap-2 mb-2">
                                {/* Interactive completed checklist toggle */}
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
          </>
        )}
      </div>
      {/* Recipe details modal */}
      {selectedRecipe && (
        <div className="modal show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 1050 }}>
          <div className="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable">
            <div className="modal-content border-0 shadow-lg">
              
              <div className="modal-header bg-body-tertiary d-flex flex-column align-items-start gap-2">
                <div className="d-flex justify-content-between align-items-center w-100">
                  <div className="d-flex align-items-center gap-2 flex-wrap">
                    <h4 className="modal-title fw-bold text-primary mb-0">{selectedRecipe.title}</h4>
                    {selectedRecipe.sourceType === 'AI_GENERATED' && (
                      <span className="badge text-dark border border-warning shadow-sm" style={{ background: 'linear-gradient(45deg, #FFD700, #FFA500)' }}>
                        ✨ AI Chef Recipe
                      </span>
                    )}
                  </div>
                  <button type="button" className="btn-close" onClick={() => setSelectedRecipe(null)}></button>
                </div>
                <div className="d-flex flex-wrap gap-1">
                  {(selectedRecipe.nutritionalInfo?.tags || []).map((tag, i) => (
                    <span key={i} className="badge badge-sage" style={{ fontSize: '0.75rem' }}>
                      {tag}
                    </span>
                  ))}
                </div>
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

                      {/* Fallback if ingredients list is empty */}
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