import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export default function Pantry() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  // Nuovo stato per gestire più campi contemporaneamente
  const [formData, setFormData] = useState({
    name: '',
    quantity: 1,
    unit: 'pieces'
  });

  useEffect(() => {
    const userString = localStorage.getItem('user');
    if (!userString) {
      navigate('/login');
      return;
    }

    const fetchPantry = async () => {
      try {
        const user = JSON.parse(userString);
        // Ricordati: stiamo usando la porta 5001
        const response = await fetch(`http://localhost:5001/api/pantry/${user.id}`);
        
        if (!response.ok) throw new Error('Failed to fetch pantry');
        
        const data = await response.json();
        setItems(data);
      } catch (err) {
        console.error(err);
        setError('Could not load pantry items.');
      }
    };

    fetchPantry();
  }, [navigate]);

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleAddItem = async (e) => {
    e.preventDefault();
    if (!formData.name.trim()) return;

    setIsLoading(true);
    setError('');

    try {
      const user = JSON.parse(localStorage.getItem('user'));
      const response = await fetch('http://localhost:5001/api/pantry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          name: formData.name,
          quantity: formData.quantity,
          unit: formData.unit
        })
      });

      if (!response.ok) throw new Error('Failed to add ingredient');

      const addedItem = await response.json();
      
      setItems([addedItem, ...items]);
      // Resettiamo solo il nome, tenendo comodi quantità e unità
      setFormData({ ...formData, name: '' }); 
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteItem = async (itemId) => {
    try {
      const response = await fetch(`http://localhost:5001/api/pantry/${itemId}`, {
        method: 'DELETE'
      });

      if (!response.ok) throw new Error('Failed to delete item');

      setItems(items.filter(item => item.id !== itemId));
    } catch (err) {
      setError('Failed to delete item.');
    }
  };

  return (
    <div className="row justify-content-center mt-4">
      <div className="col-md-10 col-lg-8">
        <h2 className="mb-4">🧺 My Pantry</h2>
        
        <div className="card shadow-sm border-0 mb-4">
          <div className="card-body p-4">
            <p className="text-muted mb-4">
              Add the ingredients you currently have at home. Specify quantity and unit for better recipe matching.
            </p>

            {error && <div className="alert alert-danger">{error}</div>}

            <form onSubmit={handleAddItem} className="row g-2 mb-4 align-items-center">
              <div className="col-md-5">
                <input 
                  type="text" 
                  className="form-control" 
                  name="name"
                  placeholder="Ingredient (e.g. Chicken)" 
                  value={formData.name}
                  onChange={handleChange}
                  disabled={isLoading}
                  required
                />
              </div>
              <div className="col-md-3">
                <input 
                  type="number" 
                  className="form-control" 
                  name="quantity"
                  min="0.1"
                  step="0.1"
                  value={formData.quantity}
                  onChange={handleChange}
                  disabled={isLoading}
                  required
                />
              </div>
              <div className="col-md-2">
                <select 
                  className="form-select" 
                  name="unit"
                  value={formData.unit}
                  onChange={handleChange}
                  disabled={isLoading}
                >
                  <option value="pieces">pcs</option>
                  <option value="g">g</option>
                  <option value="kg">kg</option>
                  <option value="ml">ml</option>
                  <option value="l">l</option>
                  <option value="tbsp">tbsp</option>
                  <option value="tsp">tsp</option>
                </select>
              </div>
              <div className="col-md-2">
                <button 
                  type="submit" 
                  className="btn btn-primary w-100 fw-bold"
                  disabled={isLoading || !formData.name.trim()}
                >
                  {isLoading ? '...' : 'Add'}
                </button>
              </div>
            </form>

            <div className="table-responsive">
              <table className="table table-hover align-middle">
                <thead className="table-light">
                  <tr>
                    <th>Ingredient</th>
                    <th>Quantity</th>
                    <th className="text-end">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {items.length === 0 ? (
                    <tr>
                      <td colSpan="3" className="text-center text-muted fst-italic py-3">
                        Your pantry is empty.
                      </td>
                    </tr>
                  ) : (
                    items.map((item) => (
                      <tr key={item.id}>
                        <td className="fw-medium text-capitalize">
                          {/* Leggiamo il nome dalla tabella relazionale! */}
                          {item.ingredient.name}
                        </td>
                        <td>
                          {item.quantity} {item.unit}
                        </td>
                        <td className="text-end">
                          <button 
                            type="button" 
                            className="btn btn-sm btn-outline-danger"
                            onClick={() => handleDeleteItem(item.id)}
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}