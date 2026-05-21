import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export default function Favorites() {
  const navigate = useNavigate();
  // Stato contenente l'array di ricette preferite (caricate dal localStorage)
  const [favorites, setFavorites] = useState([]);
  
  // Stato per gestire l'apertura del modale dei dettagli ricetta
  const [selectedRecipe, setSelectedRecipe] = useState(null);

  useEffect(() => {
    const user = JSON.parse(localStorage.getItem('user'));
    // Redirect di sicurezza se l'utente non è autenticato
    if (!user) { navigate('/login'); return; }
    
    // Carica l'elenco delle ricette preferite dallo storage locale del browser
    const storedFavorites = JSON.parse(localStorage.getItem(`favorites_${user.id}`)) || [];
    setFavorites(storedFavorites);
  }, [navigate]);

  /**
   * Rimuove una ricetta dalla lista dei preferiti e aggiorna il LocalStorage.
   */
  const removeFavorite = (e, recipeId) => {
    e.stopPropagation(); // Evita il bubbling del click (non apre il modale della ricetta)
    const user = JSON.parse(localStorage.getItem('user'));
    if (!user) return;
    
    const favKey = `favorites_${user.id}`;
    // Filtra l'array mantenendo solo gli elementi diversi da quello rimosso
    const updatedFavs = favorites.filter(f => f.id !== recipeId);
    
    localStorage.setItem(favKey, JSON.stringify(updatedFavs));
    setFavorites(updatedFavs);
    
    // Chiude il modale automaticamente se la ricetta visualizzata viene rimossa
    if (selectedRecipe && selectedRecipe.id === recipeId) {
      setSelectedRecipe(null);
    }
  };

  return (
    <div className="container mt-4 mb-5">
      <div className="d-flex flex-column flex-md-row justify-content-between align-md-items-end mb-4 gap-3">
        <div>
          <h2 className="fw-bold mb-0">Your Favorites</h2>
          <p className="text-muted mb-0">The recipes you love, saved in one place.</p>
        </div>
      </div>

      <div className="row g-4 mb-5">
        <div className="col-12">
          {favorites.length === 0 ? (
            <div className="alert alert-info border-0 shadow-sm rounded-4">You have no favorite recipes yet. Go to your Dashboard to find some!</div>
          ) : (
            <div className="row g-4">
              {favorites.map(recipe => (
                <div className="col-md-4 col-lg-3" key={recipe.id}>
                  <div 
                    className="card h-100 shadow-sm border-0 position-relative bg-body-secondary"
                    style={{ cursor: 'pointer', transition: 'transform 0.2s' }}
                    onClick={() => setSelectedRecipe(recipe)}
                  >
                    <img 
                      src={recipe.imageUrl} 
                      className="card-img-top" 
                      alt={recipe.title} 
                      style={{ height: '180px', objectFit: 'cover' }} 
                    />
                    <div 
                      className="position-absolute top-0 end-0 p-2 d-flex gap-2" 
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button 
                        className="btn btn-sm btn-light rounded-circle shadow-sm p-1 d-flex align-items-center justify-content-center"
                        style={{ width: '32px', height: '32px', zIndex: 10 }}
                        onClick={(e) => removeFavorite(e, recipe.id)}
                        title="Remove from Favorites"
                      >
                        ❤️
                      </button>
                    </div>
                    <div className="card-body d-flex flex-column">
                      <h6 className="card-title fw-bold mb-0">
                        {recipe.title}
                      </h6>
                      <div className="mt-auto pt-3 d-flex justify-content-between">
                         <span className="small text-muted fw-bold">
                           {recipe.caloriesPerServing ? `${recipe.caloriesPerServing.toFixed(0)} kcal` : 'N/A kcal'}
                         </span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Modale Dettagli Ricetta Preferita */}
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
                  {/* Lista degli Ingredienti (Gestione polimorfica tra AI e Spoonacular) */}
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
