/**
 * Spotify API Configuration
 * Note: In production, consider using environment variables
 */

export const SPOTIFY_CONFIG = {
  clientId: 'ff000ff5b98549d7b50c7fe286ad265d',
  clientSecret: '2cfece19041b40c2b69ae28cfdb3beda',
  redirectUri: 'http://127.0.0.1:8888/callback',
  scopes: [
    'user-read-currently-playing',
    'user-read-playback-state',
  ],
  // API endpoints
  authUrl: 'https://accounts.spotify.com/authorize',
  tokenUrl: 'https://accounts.spotify.com/api/token',
  apiBaseUrl: 'https://api.spotify.com/v1',
  // Polling interval for now-playing (ms)
  pollInterval: 2000,
};

/**
 * Generate a random string for PKCE code verifier
 */
export function generateCodeVerifier(length = 64): string {
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  let text = '';
  for (let i = 0; i < length; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

/**
 * Generate SHA256 hash and base64url encode for PKCE code challenge
 */
export async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);

  // Base64url encode
  const base64 = btoa(String.fromCharCode(...new Uint8Array(digest)));
  return base64
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Build the Spotify authorization URL
 */
export function buildAuthUrl(codeChallenge: string, state: string): string {
  const params = new URLSearchParams({
    client_id: SPOTIFY_CONFIG.clientId,
    response_type: 'code',
    redirect_uri: SPOTIFY_CONFIG.redirectUri,
    scope: SPOTIFY_CONFIG.scopes.join(' '),
    code_challenge_method: 'S256',
    code_challenge: codeChallenge,
    state: state,
  });

  return `${SPOTIFY_CONFIG.authUrl}?${params.toString()}`;
}
