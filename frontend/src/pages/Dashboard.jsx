import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchWithAuth } from '../utils/api';

export default function Dashboard() {
  const navigate = useNavigate();
  // Stati principali dei dati della Dashboard
  const [todayMeals, setTodayMeals] = useState([]);
  const [weeklyPlan, setWeeklyPlan] = useState(null);
  const [goals, setGoals] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [pantry, setPantry] = useState([]);
  
  // Stati per la gestione interattiva della lista della spesa
  const [checkedGroceries, setCheckedGroceries] = useState(new Set());
  const [savingItems, setSavingItems] = useState(new Set());
  
  // Stati per l'interazione UI (dettaglio ricette e preferiti)
  const [selectedRecipe, setSelectedRecipe] = useState(null);
  const [favorites, setFavorites] = useState([]);

  useEffect(() => {
    const user = JSON.parse(localStorage.getItem('user'));
    if (!user) { navigate('/login'); return; }
    
    // Carica i preferiti dallo storage locale per il rendering immediato dell'icona a cuore
    const storedFavorites = JSON.parse(localStorage.getItem(`favorites_${user.id}`)) || [];
    setFavorites(storedFavorites);
    
    fetchDashboardData(user.id);
  }, [navigate]);

  const fetchDashboardData = async (userId) => {
    setIsLoading(true);
    try {
      const goalRes = await fetchWithAuth(`/api/profile/${userId}`);
      if (goalRes.ok) setGoals(await goalRes.json());
      const pantryRes = await fetchWithAuth(`/api/pantry/${userId}`);
      if (pantryRes.ok) setPantry(await pantryRes.json());
      const planRes = await fetchWithAuth(`/api/planner/${userId}`);
      if (planRes.ok) {
        const planData = await planRes.json();
        setWeeklyPlan(planData); // Archivia l'intero piano settimanale per il calcolo della lista della spesa
        
        const todayStr = new Date().toDateString();
        const todaysEntries = planData.entries.filter(entry => 
          new Date(entry.day).toDateString() === todayStr
        );
        setTodayMeals(todaysEntries);
      }
    } catch (error) { console.error("Error loading dashboard:", error); }
    setIsLoading(false);
  };

  /**
   * Cambia lo stato "Mangiato/Non Mangiato" del pasto.
   * Utilizza l'Optimistic UI Update: aggiorna la vista immediatamente
   * e poi esegue la richiesta in background per fluidità.
   */
  const handleToggleEaten = async (entryId, currentStatus) => {
    // 1. Aggiorna lo stato locale istantaneamente
    const updatedMeals = todayMeals.map(m => m.id === entryId ? { ...m, isLocked: !currentStatus } : m);
    setTodayMeals(updatedMeals);
    
    // 2. Persiste il cambiamento sul database asincronamente
    try {
      await fetchWithAuth(`/api/planner/entry/${entryId}/toggle`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isLocked: !currentStatus })
      });
    } catch (error) { console.error("Failed to toggle status:", error); }
  };

  /**
   * Generatore Intelligente della Lista della Spesa.
   * Calcola in tempo reale gli ingredienti mancanti confrontando l'intero piano
   * settimanale con il contenuto attuale della dispensa dell'utente.
   */
  const shoppingList = useMemo(() => {
    if (!weeklyPlan || !pantry) return [];
    const items = {};
    const pantryNames = pantry.map(p => p.ingredient.name.toLowerCase());

    weeklyPlan.entries.forEach(entry => {
      // Aggrega gli ingredienti richiesti ignorando quelli già in dispensa secondo il database
      const allNeeded = [
        ...(entry.recipe.nutritionalInfo?.usedIngredients || []),
        ...(entry.recipe.nutritionalInfo?.missedIngredients || [])
      ];

      allNeeded.forEach(ing => {
        let ingName = ing.toLowerCase().trim();
        
        // Normalizzazione del testo: Rimuove stringhe descrittive come "2 cup of milk" -> "milk"
        if (ingName.includes(" of ")) {
          ingName = ingName.split(" of ").pop().trim();
        }
        
        // Pulizia avanzata tramite RegEx: elimina numeri, frazioni e unità di misura comuni
        ingName = ingName.replace(/^[\d\s\/\.,]+(cups?|tbsp|tsp|ounces?|oz|grams?|g|ml|liters?|l|lbs?|pounds?|pinch|dash|cloves?|slices?|pieces?|packages?|cans?|jars?|bottles?)?\s+/i, '').trim();

        if (!ingName) return;

        // Se l'ingrediente ripulito non si trova in dispensa, viene aggiunto al conteggio della spesa
        const isInPantry = pantryNames.some(p => ingName.includes(p) || p.includes(ingName));
        
        if (!isInPantry) {
          const displayName = ingName.charAt(0).toUpperCase() + ingName.slice(1);
          items[displayName] = (items[displayName] || 0) + 1;
        }
      });
    });
    return Object.entries(items).map(([name, count]) => ({ name, count }));
  }, [weeklyPlan, pantry]); // Ricalcolo automatico ad ogni modifica del piano o della dispensa

  const toggleGroceryItem = async (itemName) => {
    // Aggiornamento Ottimistico: Segna l'elemento come in fase di salvataggio
    setSavingItems(prev => new Set(prev).add(itemName));

    const user = JSON.parse(localStorage.getItem('user'));
    try {
      const res = await fetchWithAuth(`/api/pantry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, name: itemName, quantity: null, unit: null })
      });

      if (res.ok) {
        // Effettua un re-fetch della dispensa. L'ingrediente appena acquistato sparirà dalla lista spesa.
        const updated = await fetchWithAuth(`/api/pantry/${user.id}`);
        setPantry(await updated.json());
      }
    } catch (error) { 
      console.error(error); 
    } finally {
      // Rimuove lo spinner/disabilitazione dall'elemento
      setSavingItems(prev => {
        const newSet = new Set(prev);
        newSet.delete(itemName);
        return newSet;
      });
    }
  };

  /**
   * Gestisce l'aggiunta o la rimozione di una ricetta dai preferiti.
   * Salva il nuovo stato in LocalStorage in modo da renderlo persistente e sincronizzato
   * immediatamente tra i vari componenti (es. Dashboard e pagina Favorites).
   */
  const toggleFavorite = (e, recipe) => {
    e.stopPropagation(); // Evita di aprire il modale dei dettagli cliccando l'icona a cuore
    const user = JSON.parse(localStorage.getItem('user'));
    if (!user) return;
    
    const favKey = `favorites_${user.id}`;
    const currentFavs = JSON.parse(localStorage.getItem(favKey)) || [];
    
    const isFav = currentFavs.some(f => f.id === recipe.id);
    let updatedFavs;
    if (isFav) {
      updatedFavs = currentFavs.filter(f => f.id !== recipe.id);
    } else {
      updatedFavs = [...currentFavs, recipe];
    }
    
    localStorage.setItem(favKey, JSON.stringify(updatedFavs));
    setFavorites(updatedFavs);
  };


  if (isLoading) return <div className="container mt-5 text-center"><h5>Loading Executive Dashboard...</h5></div>;
  if (!goals) return <div className="container mt-5 text-center"><h5>Please set your Nutritional Profile first.</h5></div>;

  const eaten = todayMeals.filter(m => m.isLocked).reduce((acc, m) => ({
    cals: acc.cals + (m.recipe.caloriesPerServing || 0),
    pro: acc.pro + (m.recipe.proteinGramsPerServing || 0),
    carb: acc.carb + (m.recipe.carbsGramsPerServing || 0),
    fat: acc.fat + (m.recipe.fatGramsPerServing || 0)
  }), { cals: 0, pro: 0, carb: 0, fat: 0 });

  return (
    <div className="container mt-4 mb-5">
      <div className="d-flex flex-column flex-md-row justify-content-between align-md-items-end mb-4 gap-3">
        <div>
          <h2 className="fw-bold mb-0">Daily Action Plan</h2>
          <p className="text-muted mb-0">Here's what's cooking for today, {new Date().toLocaleDateString()}</p>
        </div>
        <button className="btn btn-outline-primary fw-bold" onClick={() => navigate('/planner')}>
          View Full Week
        </button>
      </div>

      <div className="card shadow-sm border-0 mb-5 p-4 rounded-4 bg-body-tertiary">
        <h6 className="fw-bold text-uppercase text-muted mb-4 small">Nutritional Performance (Today)</h6>
        <div className="row row-cols-1 row-cols-md-4 g-4">
          <div className="col">
            <div className="d-flex justify-content-between mb-1">
              <span className="small fw-bold">🔥 Cals</span>
              <span className="small text-muted">{eaten.cals.toFixed(0)}/{goals.dailyCalories}</span>
            </div>
            <div className="progress" style={{ height: '8px' }}>
              <div className="progress-bar bg-warning" style={{ width: `${(eaten.cals/goals.dailyCalories)*100}%` }}></div>
            </div>
          </div>
          <div className="col">
            <div className="d-flex justify-content-between mb-1">
              <span className="small fw-bold">🥩 Protein</span>
              <span className="small text-muted">{eaten.pro.toFixed(0)}/{goals.dailyProtein}g</span>
            </div>
            <div className="progress" style={{ height: '8px' }}>
              <div className="progress-bar bg-info" style={{ width: `${(eaten.pro/goals.dailyProtein)*100}%` }}></div>
            </div>
          </div>
          <div className="col">
            <div className="d-flex justify-content-between mb-1">
              <span className="small fw-bold">🌾 Carbs</span>
              <span className="small text-muted">{eaten.carb.toFixed(0)}/{goals.dailyCarbs}g</span>
            </div>
            <div className="progress" style={{ height: '8px' }}>
              <div className="progress-bar bg-success" style={{ width: `${(eaten.carb/goals.dailyCarbs)*100}%` }}></div>
            </div>
          </div>
          <div className="col">
            <div className="d-flex justify-content-between mb-1">
              <span className="small fw-bold">🥑 Fat</span>
              <span className="small text-muted">{eaten.fat.toFixed(0)}/{goals.dailyFat}g</span>
            </div>
            <div className="progress" style={{ height: '8px' }}>
              <div className="progress-bar bg-danger" style={{ width: `${(eaten.fat/goals.dailyFat)*100}%` }}></div>
            </div>
          </div>
        </div>
      </div>

      <div className="row g-4 mb-5">
        {/* Colonna di Sinistra: I Pasti Odierni */}
        <div className="col-lg-8">
          <h5 className="fw-bold mb-3">Your Meals</h5>
          {todayMeals.length === 0 ? (
            <div className="alert alert-info border-0 shadow-sm rounded-4">No meal plan generated for today. Go to Planner to start.</div>
          ) : (
            <div className="row g-4">
              {todayMeals.map(entry => (
                <div className="col-md-6" key={entry.id}>
                  <div 
                    className={`card h-100 shadow-sm border-0 position-relative ${entry.isLocked ? 'bg-body-tertiary opacity-75' : 'bg-body-secondary'}`}
                    style={{ cursor: 'pointer', transition: 'transform 0.2s' }}
                    onClick={() => setSelectedRecipe(entry.recipe)}
                  >
                    <img 
                      src={entry.recipe.imageUrl} 
                      className="card-img-top" 
                      alt={entry.recipe.title} 
                      style={{ height: '180px', objectFit: 'cover', opacity: entry.isLocked ? 0.5 : 1 }} 
                    />
                    <div 
                      className="position-absolute top-0 end-0 p-2 d-flex gap-2" 
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button 
                        className="btn btn-sm btn-light rounded-circle shadow-sm p-1 d-flex align-items-center justify-content-center"
                        style={{ width: '32px', height: '32px', zIndex: 10 }}
                        onClick={(e) => toggleFavorite(e, entry.recipe)}
                        title="Add to Favorites"
                      >
                        {favorites.some(f => f.id === entry.recipe.id) ? '❤️' : '🤍'}
                      </button>
                      <input 
                        type="checkbox" 
                        className="form-check-input shadow" 
                        style={{ transform: 'scale(1.3)', cursor: 'pointer', margin: '6px' }}
                        checked={entry.isLocked}
                        onChange={() => handleToggleEaten(entry.id, entry.isLocked)}
                      />
                    </div>
                    <div className="card-body d-flex flex-column">
                      <div className="badge bg-dark mb-2 align-self-start small">{entry.mealType}</div>
                      <h6 className={`card-title fw-bold mb-0 ${entry.isLocked ? 'text-decoration-line-through text-muted' : ''}`}>
                        {entry.recipe.title}
                      </h6>
                      <div className="mt-auto pt-3 d-flex justify-content-between">
                         <span className="small text-muted fw-bold">{entry.recipe.caloriesPerServing.toFixed(0)} kcal</span>
                         {entry.isLocked && <span className="text-success small fw-bold">COMPLETED</span>}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Colonna di Destra: Lista della Spesa Dinamica */}
        <div className="col-lg-4">
          <div className="card shadow-sm border-0 rounded-4 h-100">
            <div className="card-header bg-body-tertiary border-bottom-0 pt-4 pb-0">
              <h5 className="fw-bold mb-1">🛒 Smart Grocery List</h5>
              <p className="text-muted small">Missing ingredients for the week</p>
            </div>
            <div className="card-body overflow-auto" style={{ maxHeight: '400px' }}>
              {shoppingList.length === 0 ? (
                <p className="text-muted small fst-italic">You have all the ingredients you need! 🎉</p>
              ) : (
                <ul className="list-group list-group-flush">
                  {shoppingList.map((item, index) => {
                    const isChecked = checkedGroceries.has(item.name);
                    return (
                      <li key={index} className="list-group-item px-0 py-2 border-light d-flex align-items-center">
                        <input 
                          type="checkbox" 
                          className="form-check-input me-3" 
                          checked={savingItems.has(item.name)}
                          disabled={savingItems.has(item.name)}
                          onChange={() => toggleGroceryItem(item.name)}
                          style={{ cursor: 'pointer' }}
                        />
                        <span className={`flex-grow-1 ${isChecked ? 'text-decoration-line-through text-muted' : 'fw-medium'}`}>
                          {item.name}
                        </span>
                        <span className="badge bg-secondary border rounded-pill">
                          x{item.count}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      </div>


      {/* Modale Dettagli Ricetta */}
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
                <img 
                  src={selectedRecipe.imageUrl} 
                  className="img-fluid rounded-4 mb-4 w-100" 
                  style={{ maxHeight: '300px', objectFit: 'cover' }} 
                  alt="" 
                />

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