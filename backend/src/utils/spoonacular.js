const SPOONACULAR_BASE_URL = 'https://api.spoonacular.com';

let currentKeyIndex = 0;

export function getApiKey() {
  const keysStr = process.env.SPOONACULAR_API_KEYS || process.env.SPOONACULAR_API_KEY;
  const keys = keysStr ? keysStr.split(',').map(k => k.trim()).filter(Boolean) : [];

  if (keys.length === 0) {
    throw new Error('SPOONACULAR_API_KEYS is not configured');
  }

  const selectedKey = keys[currentKeyIndex];
  currentKeyIndex = (currentKeyIndex + 1) % keys.length;

  return selectedKey;
}

export async function spoonacularGet(path, params = {}) {
  const url = new URL(`${SPOONACULAR_BASE_URL}${path}`);
  const apiKey = getApiKey();

  for (const [key, value] of Object.entries({ ...params, apiKey })) {
    if (value === undefined || value === null || value === '') {
      continue;
    }

    url.searchParams.append(key, String(value));
  }

  const response = await fetch(url);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Spoonacular ${response.status}: ${errorText}`);
  }

  return response.json();
}
