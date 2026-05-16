import { ASSET_BASE_URL } from './constants';

export function getUploadUrl(filename: string): string {
  const base = ASSET_BASE_URL.replace(/\/$/, '');
  return `${base}/uploads/${filename}`;
}

export function isUploadPath(value: string): boolean {
  return value.startsWith('/uploads/');
}

export function resolveAssetUrl(value: string): string {
  if (!value) return value;
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith('/uploads/')) {
    const base = ASSET_BASE_URL.replace(/\/$/, '');
    return `${base}${value}`;
  }
  return value;
}
