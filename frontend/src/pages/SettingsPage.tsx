import { useLogout } from "../api/auth";
import { useAuth } from "../auth/AuthProvider";
import { Button } from "../components/ui/Button";

const LOGOUT_ERROR = "Could not sign out. Check your connection and try again.";

export function SettingsPage() {
  const auth = useAuth();
  const logout = useLogout();
  return (
    <section>
      <h1>Settings</h1>
      <p className="muted">Signed in as {auth.user?.email}</p>
      {logout.isError ? (
        <p className="error-message" role="alert">
          {LOGOUT_ERROR}
        </p>
      ) : null}
      <Button type="button" onClick={() => logout.mutate()} disabled={logout.isPending}>
        Logout
      </Button>
    </section>
  );
}
