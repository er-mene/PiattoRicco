import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchWithAuth } from '../utils/api';

export default function Profile() {
  const navigate = useNavigate();
  // Loading and UI notification states
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState('');

  // Common cuisine options for the chip picker
  const CUISINE_OPTIONS = [
    'Italian', 'Mexican', 'Japanese', 'Chinese', 'Indian',
    'Mediterranean', 'American', 'French', 'Thai', 'Greek',
    'Spanish', 'Middle Eastern', 'Korean', 'Vietnamese', 'Brazilian'
  ];

  // Diet type options for the chip picker
  const DIET_OPTIONS = [
    'Vegetarian', 'Vegan', 'Pescatarian', 'Gluten-Free', 'Dairy-Free',
    'Keto', 'Paleo', 'Low-Carb', 'Low-Fat', 'High-Protein',
    'Mediterranean', 'Whole30', 'Flexitarian', 'Carnivore'
  ];

  // Profile form state (macronutrient targets, excluded ingredients, diets, cuisines)
  const [formData, setFormData] = useState({
    dailyCalories: 2000,
    dailyProtein: 150,
    dailyCarbs: 200,
    dailyFat: 65,
    excludedIngredients: '',
    preferredCuisines: [],
    diets: []
  });

  // Lock states to freeze specific macros during auto-recalculation
  const [locked, setLocked] = useState({
    dailyCalories: false,
    dailyProtein: false,
    dailyCarbs: false,
    dailyFat: false
  });

  useEffect(() => {
    const userString = localStorage.getItem('user');
    if (!userString) {
      navigate('/login');
      return;
    }

    const user = JSON.parse(userString);

    const fetchProfile = async () => {
      try {
        const response = await fetchWithAuth(`/api/profile/${user.id}`);
        if (response.ok) {
          const data = await response.json();
            setFormData({
              dailyCalories: data.dailyCalories,
              dailyProtein: data.dailyProtein,
              dailyCarbs: data.dailyCarbs,
              dailyFat: data.dailyFat,
              excludedIngredients: data.excludedIngredients ? data.excludedIngredients.join(', ') : '',
              preferredCuisines: data.preferredCuisines || [],
              diets: data.diets || []
            });
        }
      } catch (error) {
        console.error("Error loading profile:", error);
      }
    };

    fetchProfile();
  }, [navigate]);

  // Returns the count of currently locked macros
  const getLockedCount = () => {
    return Object.values(locked).filter(Boolean).length;
  };

  // Toggles macro lock (maximum 2 locked simultaneously)
  const toggleLock = (field) => {
    if (locked[field]) {
      setLocked({ ...locked, [field]: false });
    } else if (getLockedCount() < 2) {
      setLocked({ ...locked, [field]: true });
    }
  };

  /**
   * Input blur event handler.
   * Enforces mathematical alignment: total calories must always equal the sum of macronutrients
   * (Protein x4, Carbs x4, Fat x9).
   */
  const handleBlur = () => {
    if (!locked.dailyCalories) {
      const trueCalories = Math.max(0, Math.round(formData.dailyProtein * 4 + formData.dailyCarbs * 4 + formData.dailyFat * 9));
      
      if (formData.dailyCalories !== trueCalories) {
        setFormData(prev => ({ ...prev, dailyCalories: trueCalories }));
      }
    }
  };

  const handleChange = (e) => {
    const cleanValue = e.target.value.replace(/^0+(?=\d)/, '');
    e.target.value = cleanValue;

    const name = e.target.name;
    let newValue;
    
    // Text inputs do not undergo macro numerical validation
    if (name === 'excludedIngredients') {
      setFormData({ ...formData, [name]: e.target.value });
      return;
    }

    // Cuisine toggling is handled by toggleCuisine, not handleChange
    if (name === 'preferredCuisines') return;
    
    newValue = Number(cleanValue);

    if (newValue < 0) {
      newValue = 0;
    }

    const newData = { ...formData, [name]: newValue };

    // --- SCENARIO 1: Direct editing of Total Calories ---
    if (name === 'dailyCalories') {
      const lockedMacros = ['dailyProtein', 'dailyCarbs', 'dailyFat'].filter(m => locked[m]);

      if (lockedMacros.length === 0) {
        newData.dailyCarbs = (newValue * 0.40) / 4; 
        newData.dailyProtein = (newValue * 0.30) / 4; 
        newData.dailyFat = (newValue * 0.30) / 9;     
      } else {
        let spentKcal = 0;
        if (locked.dailyProtein) spentKcal += newData.dailyProtein * 4;
        if (locked.dailyCarbs) spentKcal += newData.dailyCarbs * 4;
        if (locked.dailyFat) spentKcal += newData.dailyFat * 9;

        let remainingKcal = newValue - spentKcal;

        // Safety check: if remaining calories drop below zero during typing,
        // clamp to 0 to prevent negative macros without artificially raising total calories.
        if (remainingKcal < 0) {
          remainingKcal = 0;
        }

        const unlockedMacros = ['dailyProtein', 'dailyCarbs', 'dailyFat'].filter(m => !locked[m]);

        if (unlockedMacros.length === 1) {
          const free = unlockedMacros[0];
          if (free === 'dailyProtein') newData.dailyProtein = remainingKcal / 4;
          if (free === 'dailyCarbs') newData.dailyCarbs = remainingKcal / 4;
          if (free === 'dailyFat') newData.dailyFat = remainingKcal / 9;
        } else if (unlockedMacros.length === 2) {
          const weights = { dailyCarbs: 40, dailyProtein: 30, dailyFat: 30 };
          const w1 = weights[unlockedMacros[0]];
          const w2 = weights[unlockedMacros[1]];
          const totalW = w1 + w2;

          const kcal1 = remainingKcal * (w1 / totalW);
          const kcal2 = remainingKcal * (w2 / totalW);

          if (unlockedMacros[0] === 'dailyProtein') newData.dailyProtein = kcal1 / 4;
          else if (unlockedMacros[0] === 'dailyCarbs') newData.dailyCarbs = kcal1 / 4;
          else if (unlockedMacros[0] === 'dailyFat') newData.dailyFat = kcal1 / 9;

          if (unlockedMacros[1] === 'dailyProtein') newData.dailyProtein = kcal2 / 4;
          else if (unlockedMacros[1] === 'dailyCarbs') newData.dailyCarbs = kcal2 / 4;
          else if (unlockedMacros[1] === 'dailyFat') newData.dailyFat = kcal2 / 9;
        }
      }
    } 
    // --- SCENARIO 2: Editing a specific Macronutriente (Protein, Carbs, Fat) ---
    else {
      const fixedFields = new Set(Object.keys(locked).filter(k => locked[k]));
      fixedFields.add(name); 

      const freeFields = ['dailyCalories', 'dailyProtein', 'dailyCarbs', 'dailyFat']
        .filter(f => !fixedFields.has(f));

      if (freeFields.length > 0) {
        const fieldToAdjust = freeFields.includes('dailyCalories') ? 'dailyCalories'
                            : freeFields.includes('dailyFat') ? 'dailyFat'
                            : freeFields.includes('dailyCarbs') ? 'dailyCarbs'
                            : freeFields[0];

        const { dailyCalories, dailyProtein, dailyCarbs, dailyFat } = newData;

        if (fieldToAdjust === 'dailyCalories') {
          newData.dailyCalories = dailyProtein * 4 + dailyCarbs * 4 + dailyFat * 9;
        } else if (fieldToAdjust === 'dailyFat') {
          newData.dailyFat = (dailyCalories - dailyProtein * 4 - dailyCarbs * 4) / 9;
        } else if (fieldToAdjust === 'dailyCarbs') {
          newData.dailyCarbs = (dailyCalories - dailyProtein * 4 - dailyFat * 9) / 4;
        } else if (fieldToAdjust === 'dailyProtein') {
          newData.dailyProtein = (dailyCalories - dailyCarbs * 4 - dailyFat * 9) / 4;
        }

        if (newData[fieldToAdjust] < 0) {
          newData[fieldToAdjust] = 0;
          
          if (!locked.dailyCalories) {
            newData.dailyCalories = newData.dailyProtein * 4 + newData.dailyCarbs * 4 + newData.dailyFat * 9;
          } else {
            if (name === 'dailyProtein') newData.dailyProtein = (newData.dailyCalories - newData.dailyCarbs * 4 - newData.dailyFat * 9) / 4;
            else if (name === 'dailyCarbs') newData.dailyCarbs = (newData.dailyCalories - newData.dailyProtein * 4 - newData.dailyFat * 9) / 4;
            else if (name === 'dailyFat') newData.dailyFat = (newData.dailyCalories - newData.dailyProtein * 4 - newData.dailyCarbs * 4) / 9;
          }
        }
      }
    }

    // Round all numerical targets to integers
    Object.keys(newData).forEach(key => {
      if (typeof newData[key] === 'number') {
        newData[key] = Math.max(0, Math.round(newData[key]));
      }
    });

    // Only sync calories from macros if the user is NOT directly editing calories.
    // When editing dailyCalories, the user's typed value must be preserved as-is;
    // the macros were already derived from it above, so recalculating the sum
    // would snap the calories to a different rounded number.
    if (name !== 'dailyCalories') {
      const protein = newData.dailyProtein, carbs = newData.dailyCarbs, fat = newData.dailyFat;
      const macroSum = protein * 4 + carbs * 4 + fat * 9;
      if (macroSum !== newData.dailyCalories && !locked.dailyCalories) {
        newData.dailyCalories = macroSum;
      }
    }

    setFormData(newData);
  };

  const handleSave = async (e) => {
    e.preventDefault(); 
    setIsLoading(true);
    setMessage('');

    // --- FINAL MATHEMATICAL VALIDATION ---
    // Recompute values prior to saving to prevent target drift or race conditions.
    // Ricalcola i valori definitivi un istante prima del salvataggio per 
    // intercettare eventuali race condition dell'input.
    let safeData = { ...formData };
    
    if (locked.dailyCalories) {
      // If calories are locked, adjust macronutrients (by shifting Fat/Carbs)
      const exactCalories = safeData.dailyProtein * 4 + safeData.dailyCarbs * 4 + safeData.dailyFat * 9;
      if (Math.abs(safeData.dailyCalories - exactCalories) > 1) {
         safeData.dailyFat = Math.max(0, (safeData.dailyCalories - safeData.dailyProtein * 4 - safeData.dailyCarbs * 4) / 9);
      }
    } else {
      // If calories are unlocked, recalculate total calories based on macros
      safeData.dailyCalories = safeData.dailyProtein * 4 + safeData.dailyCarbs * 4 + safeData.dailyFat * 9;
    }

    // Final integer rounding pass
    Object.keys(safeData).forEach(key => {
      if (typeof safeData[key] === 'number') {
        safeData[key] = Math.round(safeData[key]);
      }
    });

    // Re-absorb rounding drift into unlocked macros if calories are locked
    if (locked.dailyCalories) {
      const finalSum = safeData.dailyProtein * 4 + safeData.dailyCarbs * 4 + safeData.dailyFat * 9;
      if (finalSum !== safeData.dailyCalories) {
        const diff = safeData.dailyCalories - finalSum;
        const unlockedMacros = ['dailyProtein', 'dailyCarbs', 'dailyFat'].filter(m => !locked[m]);
        if (unlockedMacros.includes('dailyFat') && diff % 9 === 0) {
          safeData.dailyFat = Math.max(0, safeData.dailyFat + diff / 9);
        } else if (unlockedMacros.includes('dailyCarbs') && diff % 4 === 0) {
          safeData.dailyCarbs = Math.max(0, safeData.dailyCarbs + diff / 4);
        } else if (unlockedMacros.includes('dailyProtein') && diff % 4 === 0) {
          safeData.dailyProtein = Math.max(0, safeData.dailyProtein + diff / 4);
        }
      }
    }

    // Sync validated targets to form state
    setFormData(safeData);

    try {
      const user = JSON.parse(localStorage.getItem('user'));

      const payload = {
        userId: user.id,
        ...safeData,
        excludedIngredients: safeData.excludedIngredients
          ? safeData.excludedIngredients.split(',').map(s => s.trim()).filter(s => s !== '')
          : [],
        preferredCuisines: safeData.preferredCuisines || [],
        diets: safeData.diets || []
      };

      const response = await fetchWithAuth('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to save profile');
      }

      setMessage('✅ Nutritional targets saved successfully!');
      
    } catch (error) {
      setMessage(`❌ Error: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="row justify-content-center mt-4">
      <div className="col-12 col-lg-10">
        <h2 className="mb-4">👤 Nutritional Profile</h2>
        
        <div className="card shadow-sm border-0">
          <div className="card-body p-4">
            <p className="text-muted mb-4">
              Set your daily targets. Our algorithm will use this data to generate custom meal plans tailored to your needs.
            </p>

            {message && (
              <div className={`alert ${message.includes('✅') ? 'alert-success' : 'alert-danger'} fw-bold`}>
                {message}
              </div>
            )}

            <form onSubmit={handleSave}>
              <div className="row g-3 mb-4">
                {/* Calories Input Group */}
                <div className="col-12 col-sm-6">
                  <label className="form-label fw-bold mb-2">Calories (kcal)</label>
                  <div className="input-group">
                    <input 
                      type="number" 
                      className="form-control form-control-lg" 
                      name="dailyCalories" 
                      value={formData.dailyCalories} 
                      onChange={handleChange}
                      onBlur={handleBlur}
                      min="0"
                      readOnly={locked.dailyCalories}
                    />
                    <button
                      type="button"
                      className={`btn btn-lg ${locked.dailyCalories ? 'btn-danger' : 'btn-outline-secondary'}`}
                      onClick={() => toggleLock('dailyCalories')}
                      title={locked.dailyCalories ? 'Unlock' : getLockedCount() < 2 ? 'Lock' : 'Max 2 locks'}
                      disabled={!locked.dailyCalories && getLockedCount() >= 2}
                    >
                      {locked.dailyCalories ? '🔒' : '🔓'}
                    </button>
                  </div>
                </div>
                
                {/* Protein Input Group */}
                <div className="col-12 col-sm-6">
                  <label className="form-label fw-bold mb-2">Protein (g)</label>
                  <div className="input-group">
                    <input 
                      type="number" 
                      className="form-control form-control-lg" 
                      name="dailyProtein" 
                      value={formData.dailyProtein} 
                      onChange={handleChange}
                      onBlur={handleBlur}
                      min="0"
                      readOnly={locked.dailyProtein}
                    />
                    <button
                      type="button"
                      className={`btn btn-lg ${locked.dailyProtein ? 'btn-danger' : 'btn-outline-secondary'}`}
                      onClick={() => toggleLock('dailyProtein')}
                      title={locked.dailyProtein ? 'Unlock' : getLockedCount() < 2 ? 'Lock' : 'Max 2 locks'}
                      disabled={!locked.dailyProtein && getLockedCount() >= 2}
                    >
                      {locked.dailyProtein ? '🔒' : '🔓'}
                    </button>
                  </div>
                </div>

                {/* Carbs Input Group */}
                <div className="col-12 col-sm-6">
                  <label className="form-label fw-bold mb-2">Carbs (g)</label>
                  <div className="input-group">
                    <input 
                      type="number" 
                      className="form-control form-control-lg" 
                      name="dailyCarbs" 
                      value={formData.dailyCarbs} 
                      onChange={handleChange}
                      onBlur={handleBlur}
                      min="0"
                      readOnly={locked.dailyCarbs}
                    />
                    <button
                      type="button"
                      className={`btn btn-lg ${locked.dailyCarbs ? 'btn-danger' : 'btn-outline-secondary'}`}
                      onClick={() => toggleLock('dailyCarbs')}
                      title={locked.dailyCarbs ? 'Unlock' : getLockedCount() < 2 ? 'Lock' : 'Max 2 locks'}
                      disabled={!locked.dailyCarbs && getLockedCount() >= 2}
                    >
                      {locked.dailyCarbs ? '🔒' : '🔓'}
                    </button>
                  </div>
                </div>

                {/* Fat Input Group */}
                <div className="col-12 col-sm-6">
                  <label className="form-label fw-bold mb-2">Fat (g)</label>
                  <div className="input-group">
                    <input 
                      type="number" 
                      className="form-control form-control-lg" 
                      name="dailyFat" 
                      value={formData.dailyFat} 
                      onChange={handleChange}
                      onBlur={handleBlur}
                      min="0"
                      readOnly={locked.dailyFat}
                    />
                    <button
                      type="button"
                      className={`btn btn-lg ${locked.dailyFat ? 'btn-danger' : 'btn-outline-secondary'}`}
                      onClick={() => toggleLock('dailyFat')}
                      title={locked.dailyFat ? 'Unlock' : getLockedCount() < 2 ? 'Lock' : 'Max 2 locks'}
                      disabled={!locked.dailyFat && getLockedCount() >= 2}
                    >
                      {locked.dailyFat ? '🔒' : '🔓'}
                    </button>
                  </div>
                </div>
              </div>

              <div className="row g-3 mb-4 mt-1">
                <div className="col-12">
                  <label className="form-label fw-bold mb-2">Excluded Ingredients</label>
                  <input 
                    type="text" 
                    className="form-control" 
                    name="excludedIngredients" 
                    value={formData.excludedIngredients} 
                    onChange={handleChange}
                    placeholder="e.g. Peanuts, Dairy, Gluten, Shellfish"
                  />
                  <div className="form-text">Comma-separated. Include allergies, intolerances, or anything you simply dislike — the AI will never use these.</div>
                </div>
              </div>

              <div className="row g-3 mb-4">
                <div className="col-12">
                  <label className="form-label fw-bold mb-2">🥗 Dietary Preferences</label>
                  <div className="d-flex flex-wrap gap-2">
                    {DIET_OPTIONS.map(diet => {
                      const isSelected = formData.diets.includes(diet);
                      return (
                        <button
                          key={diet}
                          type="button"
                          onClick={() => {
                            const updated = isSelected
                              ? formData.diets.filter(d => d !== diet)
                              : [...formData.diets, diet];
                            setFormData({ ...formData, diets: updated });
                          }}
                          className={`btn btn-sm rounded-pill ${
                            isSelected ? 'btn-success' : 'btn-outline-secondary'
                          }`}
                          style={{ fontWeight: isSelected ? '600' : '400', transition: 'all 0.15s ease' }}
                        >
                          {isSelected ? '✓ ' : ''}{diet}
                        </button>
                      );
                    })}
                  </div>
                  <div className="form-text mt-2">Select all that apply — the AI will strictly follow these dietary rules when building your plan.</div>
                </div>
              </div>

              <div className="row g-3 mb-4">
                <div className="col-12">
                  <label className="form-label fw-bold mb-2">🍽️ Preferred Cuisines</label>
                  <div className="d-flex flex-wrap gap-2">
                    {CUISINE_OPTIONS.map(cuisine => {
                      const isSelected = formData.preferredCuisines.includes(cuisine);
                      return (
                        <button
                          key={cuisine}
                          type="button"
                          onClick={() => {
                            const updated = isSelected
                              ? formData.preferredCuisines.filter(c => c !== cuisine)
                              : [...formData.preferredCuisines, cuisine];
                            setFormData({ ...formData, preferredCuisines: updated });
                          }}
                          className={`btn btn-sm rounded-pill ${
                            isSelected ? 'btn-primary' : 'btn-outline-secondary'
                          }`}
                          style={{ fontWeight: isSelected ? '600' : '400', transition: 'all 0.15s ease' }}
                        >
                          {isSelected ? '✓ ' : ''}{cuisine}
                        </button>
                      );
                    })}
                  </div>
                  <div className="form-text mt-2">Select the cuisines you enjoy most — the AI will lean into these styles when crafting your meals.</div>
                </div>
              </div>

              <button disabled={isLoading} type="submit" className="btn btn-primary w-100 btn-lg fw-bold">
                {isLoading ? 'Saving...' : 'Save Targets'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}