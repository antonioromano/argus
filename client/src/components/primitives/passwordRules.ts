/** Mirror of the server's `passwordStrength.ts` MIN_LENGTH. The common-password
 *  blocklist check stays server-side (authoritative); the client gates on length
 *  + match for the green/enabled affordance. */
export const NGROK_PW_MIN = 12;

export const isNgrokPasswordValid = (pw: string): boolean => pw.length >= NGROK_PW_MIN;
