const SPOONACULAR_BASE_URL = 'https://api.spoonacular.com';

export function getApiKey() {
  const apiKey = process.env.SPOONACULAR_API_KEY;

  if (!apiKey) {
    throw new Error('SPOONACULAR_API_KEY is not configured');
  }

  return apiKey;
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
