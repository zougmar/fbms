import axios from 'axios';

const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || '/api' });
const TOKEN_KEY = 'fbms_token';
let writes = 0;

export function readToken() {
  const tabToken = sessionStorage.getItem(TOKEN_KEY);
  if (tabToken) return tabToken;
  const switching = window.location.pathname.startsWith('/login')
    && new URLSearchParams(window.location.search).get('switch') === '1';
  if (switching) return '';
  const shared = localStorage.getItem(TOKEN_KEY);
  if (shared) sessionStorage.setItem(TOKEN_KEY, shared);
  return shared || '';
}

export function storeToken(token) {
  sessionStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearTabToken() {
  const current = sessionStorage.getItem(TOKEN_KEY);
  sessionStorage.removeItem(TOKEN_KEY);
  if (localStorage.getItem(TOKEN_KEY) === current) localStorage.removeItem(TOKEN_KEY);
}

export function writesInFlight() {
  return writes;
}

export function isStale(error) {
  return error.response?.status === 409 && error.response?.data?.code === 'stale';
}

function trackWrite(config, delta) {
  if (!config) return;
  const method = String(config.method || 'get').toLowerCase();
  if (method === 'get' || method === 'head') return;
  writes = Math.max(0, writes + delta);
}

api.interceptors.request.use((config) => {
  const token = readToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  config.headers['Accept-Language'] = localStorage.getItem('fbms_lang') || 'fr';
  trackWrite(config, 1);
  return config;
});

api.interceptors.response.use((response) => {
  trackWrite(response.config, -1);
  return response;
}, (error) => {
  trackWrite(error.config, -1);
  if (error.response?.status === 401 && !error.config?.url?.includes('/auth/login')) {
    clearTabToken();
    if (!window.location.pathname.startsWith('/login')) window.location.assign('/login');
  }
  return Promise.reject(error);
});

export function errorText(error) {
  return error.response?.data?.message || error.message || 'Erreur';
}

export async function downloadFile(url, params, filename) {
  const response = await api.get(url, { params, responseType: 'blob' });
  const blobUrl = URL.createObjectURL(response.data);
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(blobUrl);
}

export default api;
