import type { Settings } from './config';

/**
 * Source address used for throttling (backend/app/dependencies/client_ip.py).
 *
 * The forwarded header is attacker-controlled unless a trusted proxy sets it, so it is only
 * honoured when TRUSTED_PROXY is enabled (set it on Vercel, whose edge overwrites the header).
 * Route handlers have no socket address, so without a trusted proxy every request is "unknown".
 */
export function clientIp(request: Request, settings: Settings): string {
  if (settings.trustedProxy) {
    const forwarded = request.headers.get('x-forwarded-for') ?? '';
    const first = forwarded.split(',')[0].trim();
    if (first) return first.slice(0, 64);
  }
  return 'unknown';
}
