import { ownerRoute } from '../../../../../lib/api';
import { clearSessionCookie } from '../../../../../lib/auth/session';
import { getSettings } from '../../../../../lib/config';
import { noContent } from '../../../../../lib/http';
import { logout } from '../../../../../lib/services/auth';

export const POST = ownerRoute(async ({ auth }) => {
  await logout(auth);
  const response = noContent();
  clearSessionCookie(response, getSettings());
  return response;
});
