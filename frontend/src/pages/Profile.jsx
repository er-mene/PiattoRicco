import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export default function Profile() {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState('');

  // Valori di default (verranno sovrascritti se l'utente ha già salvato un profilo)
  const [formData, setFormData] = useState({
    dailyCalories: 2000,
    dailyProtein: 150,
    dailyCarbs: 200,
    dailyFat: 65
  });

  // Caricamento iniziale dei dati
  useEffect(() => {
    const userString = localStorage.getItem('user');
    if (!userString) {
      navigate('/login');
      return;
    }

    const user = JSON.parse(userString);

    // Funzione per recuperare il profilo esistente
    const fetchProfile = async () => {
      try {
        const response = await fetch(`http://localhost:5001/api/profile/${user.id}`);
        if (response.ok) {
          const data = await response.json();
          // Aggiorniamo il form con i dati del database
          setFormData({
            dailyCalories: data.dailyCalories,
            dailyProtein: data.dailyProtein,
            dailyCarbs: data.dailyCarbs,
            dailyFat: data.dailyFat
          });
        }
      } catch (error) {
        console.error("Error loading profile:", error);
      }
    };

    fetchProfile();
  }, [navigate]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData({ ...formData, [name]: Number(value) });
  };

  const handleSave = async (e) => {
    e.preventDefault(); 
    setIsLoading(true);
    setMessage('');

    try {
      const user = JSON.parse(localStorage.getItem('user'));

      // Salvataggio dei dati (NOTA: Porta 5001)
      const response = await fetch('http://localhost:5001/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          ...formData
        })
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
                  <label className="form-label fw-bold">Calories (kcal)</label>
                  <input 
                    type="number" 
                    className="form-control form-control-lg" 
                    name="dailyCalories" 
                    value={formData.dailyCalories} 
                    onChange={handleChange} 
                  />
                </div>
                
                <div className="col-6">
                  <label className="form-label fw-bold">Protein (g)</label>
                  <input 
                    type="number" 
                    className="form-control form-control-lg" 
                    name="dailyProtein" 
                    value={formData.dailyProtein} 
                    onChange={handleChange} 
                  />
                </div>

                <div className="col-6">
                  <label className="form-label fw-bold">Carbs (g)</label>
                  <input 
                    type="number" 
                    className="form-control form-control-lg" 
                    name="dailyCarbs" 
                    value={formData.dailyCarbs} 
                    onChange={handleChange} 
                  />
                </div>

                <div className="col-6">
                  <label className="form-label fw-bold">Fat (g)</label>
                  <input 
                    type="number" 
                    className="form-control form-control-lg" 
                    name="dailyFat" 
                    value={formData.dailyFat} 
                    onChange={handleChange} 
                  />
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