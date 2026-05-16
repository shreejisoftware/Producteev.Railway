export const APP_NAME = 'Producteev';
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api/v1';
export const API_ORIGIN = (() => {
	if (API_BASE_URL.startsWith('http')) {
		try {
			return new URL(API_BASE_URL).origin;
		} catch {
			return '';
		}
	}
	return '';
})();

export const SOCKET_BASE_URL = import.meta.env.VITE_SOCKET_BASE_URL || API_ORIGIN;
export const ASSET_BASE_URL = import.meta.env.VITE_ASSET_BASE_URL || API_ORIGIN;
