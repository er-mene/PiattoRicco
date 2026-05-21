import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchWithAuth } from '../utils/api';

export default function Profile() {
  const navigate = useNavigate();
  // Stato del caricamento e dei messaggi di notifica UI
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState('');

  // Modello dati del modulo del profilo (Macronutrienti e Allergie)
  const [formData, setFormData] = useState({
    dailyCalories: 2000,
    dailyProtein: 150,
    dailyCarbs: 200,
    dailyFat: 65,
    allergies: '',
    intolerances: ''
  });

  // Gestione dinamica dei lucchetti per bloccare specifici macro durante il ricalcolo
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
              allergies: data.allergies ? data.allergies.join(', ') : '',
              intolerances: data.intolerances ? data.intolerances.join(', ') : ''
            });
        }
      } catch (error) {
        console.error("Error loading profile:", error);
      }
    };

    fetchProfile();
  }, [navigate]);

  // Restituisce il numero di lucchetti attualmente attivi
  const getLockedCount = () => {
    return Object.values(locked).filter(Boolean).length;
  };

  // Attiva/Disattiva un lucchetto (massimo 2 bloccati contemporaneamente)
  const toggleLock = (field) => {
    if (locked[field]) {
      setLocked({ ...locked, [field]: false });
    } else if (getLockedCount() < 2) {
      setLocked({ ...locked, [field]: true });
    }
  };

  /**
   * Event Handler attivato quando l'utente clicca fuori da un input di testo (blur).
   * Applica una validazione matematica severa: le Calorie devono sempre corrispondere
   * all'esatta somma energetica dei Macronutrienti (Proteine x4, Carboidrati x4, Grassi x9).
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
    
    // Campi testuali (Allergie, Intolleranze) non subiscono la validazione numerica dei macro
    if (name === 'allergies' || name === 'intolerances') {
      setFormData({ ...formData, [name]: e.target.value });
      return;
    }
    
    newValue = Number(cleanValue);

    if (newValue < 0) {
      newValue = 0;
    }

    const newData = { ...formData, [name]: newValue };

    // --- SCENARIO 1: L'utente sta modificando direttamente le Calorie Totali ---
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

        // Correzione di Sicurezza: Se le calorie rimanenti diventano negative durante la digitazione,
        // le forziamo a 0 per impedire macro negativi. Non alziamo artificialmente dailyCalories
        // per permettere all'utente di finire di digitare il numero.
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
    // --- SCENARIO 2: L'utente sta modificando un Macronutriente (Proteine, Carboidrati, Grassi) ---
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

    // Arrotonda matematicamente tutti i valori numerici a interi
    Object.keys(newData).forEach(key => {
      if (typeof newData[key] === 'number') {
        newData[key] = Math.max(0, Math.round(newData[key]));
      }
    });

    const protein = newData.dailyProtein, carbs = newData.dailyCarbs, fat = newData.dailyFat;
    const macroSum = protein * 4 + carbs * 4 + fat * 9;
    if (macroSum !== newData.dailyCalories && !locked.dailyCalories) {
      newData.dailyCalories = macroSum;
    }

    setFormData(newData);
  };

  const handleSave = async (e) => {
    e.preventDefault(); 
    setIsLoading(true);
    setMessage('');

    // --- VALIDAZIONE FINALE DI SICUREZZA ---
    // Ricalcola i valori definitivi un istante prima del salvataggio per 
    // intercettare eventuali race condition dell'input.
    let safeData = { ...formData };
    
    if (locked.dailyCalories) {
      // Se le Calorie sono bloccate, i macro devono adattarsi ad esse (regolando Carboidrati o Grassi)
      const exactCalories = safeData.dailyProtein * 4 + safeData.dailyCarbs * 4 + safeData.dailyFat * 9;
      if (Math.abs(safeData.dailyCalories - exactCalories) > 1) {
         safeData.dailyFat = Math.max(0, (safeData.dailyCalories - safeData.dailyProtein * 4 - safeData.dailyCarbs * 4) / 9);
      }
    } else {
      // Se le Calorie sono sbloccate, la priorità va ai macro e le calorie vengono sovrascritte
      safeData.dailyCalories = safeData.dailyProtein * 4 + safeData.dailyCarbs * 4 + safeData.dailyFat * 9;
    }

    // Ultimo passaggio di arrotondamento prima del commit
    Object.keys(safeData).forEach(key => {
      if (typeof safeData[key] === 'number') {
        safeData[key] = Math.round(safeData[key]);
      }
    });

    // Se le Calorie sono bloccate, riassorbi il residuo di arrotondamento nei macro sbloccati
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

    // Aggiorna la UI riflettendo i dati matematicamente garantiti
    setFormData(safeData);

    try {
      const user = JSON.parse(localStorage.getItem('user'));

      const payload = {
        userId: user.id,
        ...safeData,
        allergies: safeData.allergies ? safeData.allergies.split(',').map(s => s.trim()).filter(s => s !== '') : [],
        intolerances: safeData.intolerances ? safeData.intolerances.split(',').map(s => s.trim()).filter(s => s !== '') : []
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
      <div className="col-md-8 col-lg-6">
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
                <div className="col-6">
                  <div className="d-flex align-items-center gap-2 mb-2">
                    <label className="form-label fw-bold mb-0">Calories (kcal)</label>
                    <button
                      type="button"
                      className={`btn btn-sm ${locked.dailyCalories ? 'btn-danger' : 'btn-outline-secondary'}`}
                      onClick={() => toggleLock('dailyCalories')}
                      title={locked.dailyCalories ? 'Unlock' : getLockedCount() < 2 ? 'Lock' : 'Max 2 locks'}
                      disabled={!locked.dailyCalories && getLockedCount() >= 2}
                    >
                      {locked.dailyCalories ? '🔒' : '🔓'}
                    </button>
                  </div>
                  <input 
                    type="number" 
                    className="form-control form-control-lg" 
                    name="dailyCalories" 
                    value={formData.dailyCalories} 
                    onChange={handleChange}
                    onBlur={handleBlur}  /* <--- ADDED HERE */
                    min="0"
                    readOnly={locked.dailyCalories}
                  />
                </div>
                
                <div className="col-6">
                  <div className="d-flex align-items-center gap-2 mb-2">
                    <label className="form-label fw-bold mb-0">Protein (g)</label>
                    <button
                      type="button"
                      className={`btn btn-sm ${locked.dailyProtein ? 'btn-danger' : 'btn-outline-secondary'}`}
                      onClick={() => toggleLock('dailyProtein')}
                      title={locked.dailyProtein ? 'Unlock' : getLockedCount() < 2 ? 'Lock' : 'Max 2 locks'}
                      disabled={!locked.dailyProtein && getLockedCount() >= 2}
                    >
                      {locked.dailyProtein ? '🔒' : '🔓'}
                    </button>
                  </div>
                  <input 
                    type="number" 
                    className="form-control form-control-lg" 
                    name="dailyProtein" 
                    value={formData.dailyProtein} 
                    onChange={handleChange}
                    onBlur={handleBlur}  /* <--- ADDED HERE */
                    min="0"
                    readOnly={locked.dailyProtein}
                  />
                </div>

                <div className="col-6">
                  <div className="d-flex align-items-center gap-2 mb-2">
                    <label className="form-label fw-bold mb-0">Carbs (g)</label>
                    <button
                      type="button"
                      className={`btn btn-sm ${locked.dailyCarbs ? 'btn-danger' : 'btn-outline-secondary'}`}
                      onClick={() => toggleLock('dailyCarbs')}
                      title={locked.dailyCarbs ? 'Unlock' : getLockedCount() < 2 ? 'Lock' : 'Max 2 locks'}
                      disabled={!locked.dailyCarbs && getLockedCount() >= 2}
                    >
                      {locked.dailyCarbs ? '🔒' : '🔓'}
                    </button>
                  </div>
                  <input 
                    type="number" 
                    className="form-control form-control-lg" 
                    name="dailyCarbs" 
                    value={formData.dailyCarbs} 
                    onChange={handleChange}
                    onBlur={handleBlur}  /* <--- ADDED HERE */
                    min="0"
                    readOnly={locked.dailyCarbs}
                  />
                </div>

                <div className="col-6">
                  <div className="d-flex align-items-center gap-2 mb-2">
                    <label className="form-label fw-bold mb-0">Fat (g)</label>
                    <button
                      type="button"
                      className={`btn btn-sm ${locked.dailyFat ? 'btn-danger' : 'btn-outline-secondary'}`}
                      onClick={() => toggleLock('dailyFat')}
                      title={locked.dailyFat ? 'Unlock' : getLockedCount() < 2 ? 'Lock' : 'Max 2 locks'}
                      disabled={!locked.dailyFat && getLockedCount() >= 2}
                    >
                      {locked.dailyFat ? '🔒' : '🔓'}
                    </button>
                  </div>
                  <input 
                    type="number" 
                    className="form-control form-control-lg" 
                    name="dailyFat" 
                    value={formData.dailyFat} 
                    onChange={handleChange}
                    onBlur={handleBlur}  /* <--- ADDED HERE */
                    min="0"
                    readOnly={locked.dailyFat}
                  />
                </div>
              </div>

              <div className="row g-3 mb-4 mt-1">
                <div className="col-md-6">
                  <label className="form-label fw-bold mb-2">Allergies</label>
                  <input 
                    type="text" 
                    className="form-control" 
                    name="allergies" 
                    value={formData.allergies} 
                    onChange={handleChange}
                    placeholder="e.g. Peanuts, Shellfish"
                  />
                  <div className="form-text">Comma-separated ingredients to strictly avoid.</div>
                </div>

                <div className="col-md-6">
                  <label className="form-label fw-bold mb-2">Intolerances</label>
                  <input 
                    type="text" 
                    className="form-control" 
                    name="intolerances" 
                    value={formData.intolerances} 
                    onChange={handleChange}
                    placeholder="e.g. Dairy, Gluten"
                  />
                  <div className="form-text">Comma-separated dietary intolerances.</div>
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