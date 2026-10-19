import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useLogout } from "../api/auth";
import { useAuth } from "../auth/AuthProvider";
import { useKeyboardOpen } from "../hooks/useKeyboardOpen";
import { HomeIcon, ListIcon, MenuIcon, PlusIcon, WalletIcon } from "./icons";
import { Button } from "./ui/Button";

const LOGOUT_ERROR = "Could not sign out. Check your connection and try again.";

function DesktopNav({ onLogout, busy }: { onLogout: () => void; busy: boolean }) {
  return (
    <nav className="sidebar" aria-label="Main">
      <NavLink to="/transactions/new" className="btn btn-primary add-link">
        Add transaction
      </NavLink>
      <NavLink to="/dashboard" className="nav-link">
        Dashboard
      </NavLink>
      <NavLink to="/transactions" end className="nav-link">
        Transactions
      </NavLink>
      <NavLink to="/accounts" className="nav-link">
        Accounts
      </NavLink>
      <NavLink to="/budget" className="nav-link">
        Monthly budget
      </NavLink>
      <NavLink to="/calendar" className="nav-link">
        Calendar
      </NavLink>
      <NavLink to="/settings" className="nav-link">
        Settings
      </NavLink>
      <Button variant="plain" className="nav-link" type="button" onClick={onLogout} disabled={busy}>
        Logout
      </Button>
    </nav>
  );
}

type MobileNavProps = {
  email: string | undefined;
  onLogout: () => void;
  busy: boolean;
  failed: boolean;
  hidden: boolean;
};

function MobileNav({ email, onLogout, busy, failed, hidden }: MobileNavProps) {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const trigger = useRef<HTMLButtonElement>(null);
  const sheet = useRef<HTMLDivElement>(null);

  useEffect(() => setOpen(false), [location.pathname]);

  useEffect(() => {
    if (open) sheet.current?.querySelector<HTMLElement>("a, button")?.focus();
  }, [open]);

  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };

  const onSheetKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const items = sheet.current?.querySelectorAll<HTMLElement>("a, button:not(:disabled)");
    if (!items || items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <>
      {/* Labels stay short (max 9 characters): five equal columns must fit a 320px phone. */}
      <nav className={hidden && !open ? "bottom-nav is-hidden" : "bottom-nav"} aria-label="Mobile">
        <NavLink to="/dashboard" className="tab">
          <HomeIcon />
          <span>Home</span>
        </NavLink>
        <NavLink to="/transactions" end className="tab">
          <ListIcon />
          <span>History</span>
        </NavLink>
        <NavLink to="/transactions/new" className="tab tab-add" aria-label="Add transaction">
          <span className="tab-add-icon">
            <PlusIcon />
          </span>
          <span>Add</span>
        </NavLink>
        <NavLink to="/accounts" className="tab">
          <WalletIcon />
          <span>Accounts</span>
        </NavLink>
        <button
          ref={trigger}
          type="button"
          className="tab"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls="more-sheet"
          onClick={() => setOpen((value) => !value)}
        >
          <MenuIcon />
          <span>More</span>
        </button>
      </nav>
      {open ? (
        <>
          <div className="sheet-backdrop more-backdrop" onClick={close} aria-hidden="true" />
          <div
            id="more-sheet"
            ref={sheet}
            className="sheet more-sheet"
            role="dialog"
            aria-label="More"
            onKeyDown={onSheetKeyDown}
          >
            {email ? <p className="sheet-email">{email}</p> : null}
            <NavLink to="/budget" className="sheet-item">
              Monthly budget
            </NavLink>
            <NavLink to="/calendar" className="sheet-item">
              Calendar
            </NavLink>
            <NavLink to="/settings" className="sheet-item">
              Settings
            </NavLink>
            {failed ? (
              <p className="error-message" role="alert">
                {LOGOUT_ERROR}
              </p>
            ) : null}
            <button
              type="button"
              className="sheet-item sheet-danger"
              onClick={onLogout}
              disabled={busy}
            >
              Logout
            </button>
          </div>
        </>
      ) : null}
    </>
  );
}

export function Layout() {
  const auth = useAuth();
  const logout = useLogout();
  const keyboardOpen = useKeyboardOpen();
  const onLogout = () => {
    if (!logout.isPending) logout.mutate();
  };
  return (
    <div className={keyboardOpen ? "app-shell kbd-open" : "app-shell"}>
      <header className="topbar">
        <p className="brand">Finance Tracker</p>
        <span className="owner-email">{auth.user?.email}</span>
      </header>
      <DesktopNav onLogout={onLogout} busy={logout.isPending} />
      <main className="content">
        {logout.isError ? (
          <p className="error-message desktop-only" role="alert">
            {LOGOUT_ERROR}
          </p>
        ) : null}
        <Outlet />
      </main>
      <MobileNav
        email={auth.user?.email}
        onLogout={onLogout}
        busy={logout.isPending}
        failed={logout.isError}
        hidden={keyboardOpen}
      />
    </div>
  );
}
