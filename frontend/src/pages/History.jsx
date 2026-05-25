import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchWithAuth } from '../utils/api';

export default function History() {
  const navigate = useNavigate();
  // array formattato contenente i raggruppamenti per giorno
  const [historyDays, setHistoryDays] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  
  // Stato per gestire l'apertura del modale di dettaglio
  const [selectedRecipe, setSelectedRecipe] = useState(null);

  useEffect(() => {
    const user = JSON.parse(localStorage.getItem('user'));
    if (!user) { navigate('/login'); return; }

    const fetchHistory = async () => {
      try {
        const response = await fetchWithAuth(`/api/planner/history/${user.id}`);
        if (response.ok) {
          const entries = await response.json();
          // Raggruppa i pasti storici in base alla data di consumazione
          const grouped = entries.reduce((acc, entry) => {
            const dateStr = new Date(entry.day).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
            if (!acc[dateStr]) {
              acc[dateStr] = {
                date: entry.day,
                entries: [],
                totals: { calories: 0, protein: 0, carbs: 0, fat: 0 }
              };
            }
            acc[dateStr].entries.push(entry);
            // Accumulo dinamico dei macronutrienti per calcolare il totale consumato nel giorno
            acc[dateStr].totals.calories += entry.recipe.caloriesPerServing || 0;
            acc[dateStr].totals.protein += entry.recipe.proteinGramsPerServing || 0;
            acc[dateStr].totals.carbs += entry.recipe.carbsGramsPerServing || 0;
            acc[dateStr].totals.fat += entry.recipe.fatGramsPerServing || 0;
            return acc;
          }, {});

          // Converte l'oggetto raggruppato in un array iterabile e lo ordina cronologicamente (dal più recente)
          const daysArray = Object.keys(grouped).map(k => ({
            label: k,
            ...grouped[k]
          })).sort((a, b) => new Date(b.date) - new Date(a.date));

          setHistoryDays(daysArray);
        }
      } catch (error) {
        console.error("Failed to fetch history:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchHistory();
  }, [navigate]);

  const handleRemoveEntry = async (e, entryId) => {
    e.stopPropagation();
    try {
      const response = await fetchWithAuth(`/api/planner/entry/${entryId}/toggle`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isLocked: false })
      });
      if (response.ok) {
        setHistoryDays(prev => {
          const newDays = prev.map(day => {
            if (day.entries.some(ent => ent.id === entryId)) {
              const removedEntry = day.entries.find(ent => ent.id === entryId);
              return {
                ...day,
                entries: day.entries.filter(ent => ent.id !== entryId),
                totals: {
                  calories: day.totals.calories - (removedEntry.recipe.caloriesPerServing || 0),
                  protein: day.totals.protein - (removedEntry.recipe.proteinGramsPerServing || 0),
                  carbs: day.totals.carbs - (removedEntry.recipe.carbsGramsPerServing || 0),
                  fat: day.totals.fat - (removedEntry.recipe.fatGramsPerServing || 0),
                }
              };
            }
            return day;
          });
          return newDays.filter(day => day.entries.length > 0);
        });
      }
    } catch (error) {
      console.error("Failed to remove history entry:", error);
    }
  };

  return (
    <div className="mt-4 mb-5">
      <div className="d-flex flex-column flex-md-row justify-content-between align-md-items-end mb-4 gap-3">
        <div>
          <h2 className="fw-bold mb-0">Meal History</h2>
          <p className="text-muted mb-0">A log of all the meals you have enjoyed.</p>
        </div>
      </div>

      {isLoading ? (
        <div className="text-center mt-5">
          <div className="spinner-border text-primary" role="status">
            <span className="visually-hidden">Loading...</span>
          </div>
        </div>
      ) : historyDays.length === 0 ? (
        <div className="alert alert-info border-0 shadow-sm rounded-4">
          You haven't eaten any meals yet. Lock in meals in the Meal Planner to see them here!
        </div>
      ) : (
        <div className="row g-4 mb-5">
          {historyDays.map((dayData, index) => (
            <div className="col-12" key={index}>
              <div className="card border-0 shadow-sm rounded-4 overflow-hidden mb-4 bg-body-secondary">
                <div className="card-header bg-dark text-white p-3 d-flex justify-content-between align-items-center">
                  <h5 className="fw-bold mb-0">{dayData.label}</h5>
                  <div className="d-flex gap-3 small text-light">
                    <span><strong>{dayData.totals.calories.toFixed(0)}</strong> kcal</span>
                    <span><strong>{dayData.totals.protein.toFixed(0)}g</strong> Pro</span>
                    <span><strong>{dayData.totals.carbs.toFixed(0)}g</strong> Carb</span>
                    <span><strong>{dayData.totals.fat.toFixed(0)}g</strong> Fat</span>
                  </div>
                </div>
                <div className="card-body p-4">
                  <div className="row g-3">
                    {dayData.entries.map((entry) => (
                      <div className="col-md-6 col-lg-4" key={entry.id}>
                        <div 
                          className="position-relative d-flex gap-3 bg-body p-2 rounded-3 shadow-sm align-items-center h-100 border hover-card"
                          style={{ cursor: 'pointer' }}
                          onClick={() => setSelectedRecipe(entry.recipe)}
                        >
                          <button
                            className="btn btn-sm btn-outline-danger position-absolute bg-white"
                            style={{ top: '4px', right: '4px', padding: '1px 6px', fontSize: '10px', zIndex: 10, borderRadius: '50%' }}
                            onClick={(e) => handleRemoveEntry(e, entry.id)}
                            title="Remove from history"
                          >
                            ✕
                          </button>

                          <div>
                            <span className="badge bg-secondary mb-1">{entry.mealType}</span>
                            <h6 className="fw-bold mb-1 text-truncate" style={{ maxWidth: '150px' }}>
                              {entry.recipe.title}
                            </h6>
                            <span className="small text-muted fw-bold">
                              {entry.recipe.caloriesPerServing ? `${entry.recipe.caloriesPerServing.toFixed(0)} kcal` : 'N/A kcal'}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modale Dettagli Ricetta dello Storico */}
      {selectedRecipe && (
        <div className="modal fade show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.7)', zIndex: 1050 }}>
          <div className="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable">
            <div className="modal-content border-0 rounded-4 shadow-lg">
              <div className="modal-header border-0 pb-0">
                <div className="d-flex align-items-center gap-2">
                  <h5 className="fw-bold mb-0">{selectedRecipe.title}</h5>
                  {selectedRecipe.sourceType === 'AI_GENERATED' && (
                    <span className="badge text-dark border border-warning shadow-sm" style={{ background: 'linear-gradient(45deg, #FFD700, #FFA500)' }}>
                      ✨ AI Chef Recipe
                    </span>
                  )}
                </div>
                <button type="button" className="btn-close" onClick={() => setSelectedRecipe(null)}></button>
              </div>
              
              <div className="modal-body p-4">


                <div className="row g-4">
                  <div className="col-md-5">
                    <h6 className="fw-bold mb-3 text-uppercase small text-muted">Ingredients</h6>
                    <ul className="list-group list-group-flush small">
                      {(selectedRecipe.nutritionalInfo?.ingredientsList || selectedRecipe.nutritionalInfo?.extendedIngredients)?.map((ing, idx) => (
                        <li key={idx} className="list-group-item px-0 border-light py-2">
                          {ing.original ? (
                            <span>• {ing.original}</span>
                          ) : (
                            <span>
                              <strong className="text-primary">{ing.amount} {ing.unit}</strong> <span className="text-capitalize">{ing.name}</span>
                            </span>
                          )}
                        </li>
                      )) || <li className="text-muted">No details available</li>}
                    </ul>
                  </div>

                  <div className="col-md-7 border-start ps-4">
                    <h6 className="fw-bold mb-3 text-uppercase small text-muted">Instructions</h6>
                    <div 
                      className="small text-secondary"
                      dangerouslySetInnerHTML={{ __html: selectedRecipe.instructions || '<i>No instructions provided.</i>' }}
                    />
                    
                    {selectedRecipe.sourceUrl && (
                      <div className="mt-4 pt-3 border-top">
                        <a 
                          href={selectedRecipe.sourceUrl} 
                          target="_blank" 
                          rel="noopener noreferrer" 
                          className="btn btn-sm btn-outline-primary fw-bold"
                        >
                          View Original Recipe ↗
                        </a>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="modal-footer border-0">
                <button className="btn btn-secondary fw-bold px-4" onClick={() => setSelectedRecipe(null)}>Close</button>
              </div>
            </div>
          </div>
        </div>
      )}            
    </div>
  );
}
