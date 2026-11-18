import { ownerRoute } from '../../../../../lib/api';
import { getSettings } from '../../../../../lib/config';
import { json } from '../../../../../lib/http';
import { sessionResponsePayload } from '../../../../../lib/services/auth';

export const GET = ownerRoute(async ({ auth }) => json(sessionResponsePayload(auth, getSettings())), {
  csrf: false,
});
