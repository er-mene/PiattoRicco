import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchWithAuth } from '../utils/api';

function QuickRecipe() {
  const navigate = useNavigate();
  const [mealType, setMealType] = useState('LUNCH');
  const [isStrictMode, setIsStrictMode] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [recipe, setRecipe] = useState(null);
  
  // Per gestire i favoriti senza database, usiamo localStorage
  const [favorites, setFavorites] = useState([]);
  const [userId, setUserId] = useState(null);

  useEffect(() => {
    const userStr = localStorage.getItem('user');
    if (!userStr) {
      navigate('/login');
      return;
    }
    const user = JSON.parse(userStr);
    setUserId(user.id);
    const storedFavs = JSON.parse(localStorage.getItem(`favorites_${user.id}`)) || [];
    setFavorites(storedFavs);

    // Recupera l'ultima Quick Recipe generata se esiste
    const savedQuickRecipe = localStorage.getItem(`quick_recipe_${user.id}`);
    if (savedQuickRecipe) {
      try {
        const parsed = JSON.parse(savedQuickRecipe);
        if (parsed.recipe) setRecipe(parsed.recipe);
        if (parsed.mealType) setMealType(parsed.mealType);
        if (parsed.isStrictMode !== undefined) setIsStrictMode(parsed.isStrictMode);
      } catch (e) {
        console.error("Failed to parse saved quick recipe");
      }
    }
  }, [navigate]);

  const handleGenerate = async () => {
    setIsLoading(true);
    setError(null);
    setRecipe(null);

    try {
      const response = await fetchWithAuth('/api/planner/generate-single', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ mealType, isStrictPantryMode: isStrictMode })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to generate recipe');
      }

      const data = await response.json();
      setRecipe(data.recipe);
      
      // Salva nel localStorage per mantenere la ricetta tra i cambi di pagina
      localStorage.setItem(`quick_recipe_${userId}`, JSON.stringify({
        recipe: data.recipe,
        mealType,
        isStrictMode
      }));
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleFavorite = () => {
    if (!recipe || !userId) return;
    
    // Controlliamo se la ricetta attuale è già nei preferiti
    // Usiamo il titolo come ID univoco dato che l'ID è finto per le quick recipes
    const isFav = favorites.some(f => f.title === recipe.title);
    
    let newFavorites;
    if (isFav) {
      newFavorites = favorites.filter(f => f.title !== recipe.title);
    } else {
      // Per compatibilità con la pagina Favorites, wrappiamo i campi
      const favRecipe = {
        ...recipe,
        recipeId: recipe.id,
        recipe: { ...recipe }
      };
      newFavorites = [...favorites, favRecipe];
    }
    
    setFavorites(newFavorites);
    localStorage.setItem(`favorites_${userId}`, JSON.stringify(newFavorites));
  };

  const isCurrentRecipeFavorite = recipe ? favorites.some(f => f.title === recipe.title) : false;

  return (
    <div className="mt-4 mb-5">
      {/* Header Form */}
      <div className="card shadow-sm border-0 mb-4 p-4 rounded-4 bg-body-tertiary">
        <h2 className="fw-bold mb-4">Quick Recipe Generator</h2>
        
        {error && <div className="alert alert-danger shadow-sm">{error}</div>}

        <div className="row g-4 align-items-center">
          {/* Meal Type Selection */}
          <div className="col-md-5">
            <label className="form-label fw-bold">Select Meal Type</label>
            <select 
              className="form-select form-select-lg shadow-sm" 
              value={mealType} 
              onChange={(e) => setMealType(e.target.value)}
              disabled={isLoading}
            >
              <option value="BREAKFAST">🍳 Breakfast</option>
              <option value="LUNCH">🥗 Lunch</option>
              <option value="DINNER">🍝 Dinner</option>
              <option value="SNACK">🍎 Snack</option>
            </select>
          </div>

          {/* Strict Mode Toggle */}
          <div className="col-md-4">
            <div 
              className="d-flex align-items-center gap-3 px-3 py-2 rounded-pill shadow-sm" 
              style={{ 
                background: isStrictMode ? 'linear-gradient(45deg, #198754, #20c997)' : 'rgba(255,255,255,0.05)',
                border: isStrictMode ? 'none' : '1px solid var(--pr-border-color)',
                transition: 'all 0.3s ease',
                height: '48px',
                marginTop: '32px' // allinea col select
              }}
            >
              <div className="form-check form-switch mb-0 fs-6 fs-md-5 w-100 d-flex justify-content-between align-items-center">
                <label className={`form-check-label text-truncate me-2 ${isStrictMode ? 'text-white fw-bold' : 'text-light fw-medium'}`} htmlFor="strictModeQuick" style={{ maxWidth: 'calc(100% - 45px)' }}>
                  Strict Pantry Mode
                </label>
                <input 
                  className="form-check-input flex-shrink-0" 
                  type="checkbox" 
                  role="switch" 
                  id="strictModeQuick" 
                  checked={isStrictMode}
                  onChange={(e) => setIsStrictMode(e.target.checked)}
                  disabled={isLoading}
                  style={{ cursor: 'pointer' }}
                />
              </div>
            </div>
          </div>

          {/* Generate Button */}
          <div className="col-md-3 mt-md-auto mt-4">
            <button 
              className="btn btn-primary btn-lg w-100 fw-bold shadow-sm rounded-pill" 
              style={{ height: '48px' }}
              onClick={handleGenerate}
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
                  Cooking...
                </>
              ) : '✨ Generate'}
            </button>
          </div>
        </div>
      </div>

      {/* Result Card */}
      {recipe && !isLoading && (
        <div className="row justify-content-center">
          <div className="col-lg-10">
            <div className="card border-0 shadow-lg rounded-4 overflow-hidden bg-body-secondary mt-3">
              <div className="card-body p-4 p-lg-5">
                
                {/* Header: Title, Badges, Heart Button */}
                <div className="d-flex justify-content-between align-items-start mb-4 border-bottom border-secondary pb-3">
                  <div>
                    <h2 className="card-title fw-bold text-primary mb-2">{recipe.title}</h2>
                    <div>
                      <span className="badge bg-warning text-dark border border-warning shadow-sm me-2 fs-6">
                        ✨ AI Generated
                      </span>
                      <span className="badge bg-dark border shadow-sm fs-6">
                        {mealType}
                      </span>
                    </div>
                  </div>
                  <button 
                    onClick={toggleFavorite}
                    className="btn btn-light rounded-circle shadow-sm border p-2 d-flex align-items-center justify-content-center hover-card flex-shrink-0"
                    style={{ width: '50px', height: '50px', fontSize: '1.2rem' }}
                  >
                    {isCurrentRecipeFavorite ? '❤️' : '🤍'}
                  </button>
                </div>
                
                {/* Macros */}
                <div className="row text-center g-2 mb-4">
                  <div className="col-3">
                    <div className="p-2 bg-body-tertiary rounded-3 border">
                      <small className="d-block text-muted">Cals</small>
                      <strong className="text-warning fs-5">{recipe.caloriesPerServing}</strong>
                    </div>
                  </div>
                  <div className="col-3">
                    <div className="p-2 bg-body-tertiary rounded-3 border">
                      <small className="d-block text-muted">Pro</small>
                      <strong className="text-info fs-5">{recipe.proteinGramsPerServing}g</strong>
                    </div>
                  </div>
                  <div className="col-3">
                    <div className="p-2 bg-body-tertiary rounded-3 border">
                      <small className="d-block text-muted">Carbs</small>
                      <strong className="text-success fs-5">{recipe.carbsGramsPerServing}g</strong>
                    </div>
                  </div>
                  <div className="col-3">
                    <div className="p-2 bg-body-tertiary rounded-3 border">
                      <small className="d-block text-muted">Fat</small>
                      <strong className="text-danger fs-5">{recipe.fatGramsPerServing}g</strong>
                    </div>
                  </div>
                </div>

                <div className="row g-4">
                  {/* Ingredients */}
                  <div className="col-sm-5">
                    <h5 className="fw-bold mb-3 border-bottom border-secondary pb-2">Ingredients</h5>
                    <ul className="list-group list-group-flush small">
                      {recipe.nutritionalInfo.ingredientsList.map((ing, i) => {
                        const isMissing = recipe.nutritionalInfo.missedIngredients.includes(ing.name);
                        return (
                          <li key={i} className="list-group-item px-0 py-1 d-flex justify-content-between text-capitalize border-0 bg-transparent">
                            <span className={isMissing ? "text-danger fw-medium" : "text-light"}>
                              {isMissing && <span className="me-1">⚠️</span>}
                              {ing.name}
                            </span>
                            <span className="text-muted fw-bold">{ing.amount} {ing.unit}</span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>

                  {/* Instructions */}
                  <div className="col-sm-7">
                    <h5 className="fw-bold mb-3 border-bottom border-secondary pb-2">Instructions</h5>
                    <div 
                      className="small text-light" 
                      style={{ lineHeight: '1.6' }}
                      dangerouslySetInnerHTML={{ __html: recipe.instructions }} 
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Empty State / Welcome */}
      {!recipe && !isLoading && (
        <div className="card border-0 shadow-sm text-center p-5 mt-4 bg-body-tertiary rounded-4">
          <div className="fs-1 mb-3">⚡️</div>
          <h4 className="fw-bold">Need a quick meal idea?</h4>
          <p className="text-muted mb-0">Select your meal type and generate a single recipe tailored to your goals in seconds.</p>
        </div>
      )}
    </div>
  );
}

export default QuickRecipe;
