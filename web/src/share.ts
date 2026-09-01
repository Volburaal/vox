/**
 * Carrying a program in a URL, so a documentation snippet can open in the
 * playground without a backend. base64url keeps it safe in a query string.
 */

export function encodeSource(source: string): string {
  const bytes = new TextEncoder().encode(source);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeSource(encoded: string | null): string | null {
  if (!encoded) return null;
  try {
    const padded = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null; // a mangled link should not blank the editor
  }
}
