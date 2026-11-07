/** Which Google OAuth step this request is. Both URLs hit the same Vercel file. */
export function googleOAuthStep(url?: string): 'initiate' | 'callback' {
  const path = (url || '').split('?')[0];
  return path.includes('/initiate') ? 'initiate' : 'callback';
}
