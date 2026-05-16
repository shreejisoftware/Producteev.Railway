/**
 * Opens OAuth in a new tab. Returns false when the browser likely blocked the popup
 * (caller should toast and/or show the URL for manual paste).
 */
export function openOAuthPopup(url: string): boolean {
  const w = window.open(url, '_blank', 'noopener,noreferrer');
  if (w == null) {
    void navigator.clipboard.writeText(url).catch(() => {});
    return false;
  }
  return true;
}
