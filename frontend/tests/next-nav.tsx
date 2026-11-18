import { vi } from "vitest";

export type NavState = {
  pathname: string;
  search: string;
  params: Record<string, string>;
};

export let nav: NavState = { pathname: "/", search: "", params: {} };

const listeners = new Set<() => void>();

export function subscribeNav(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify() {
  for (const listener of listeners) listener();
}

export const replaceMock = vi.fn((href: string) => {
  applyHref(href);
});
export const pushMock = vi.fn((href: string) => {
  applyHref(href);
});

function applyHref(href: string) {
  const url = new URL(href, "http://localhost");
  nav = {
    pathname: url.pathname,
    search: url.search.startsWith("?") ? url.search.slice(1) : url.search,
    params: parseParams(url.pathname),
  };
  notify();
}

export function parseParams(pathname: string): Record<string, string> {
  const tx = pathname.match(/^\/transactions\/([^/]+)$/);
  if (tx && tx[1] !== "new") return { id: tx[1] };
  const edit = pathname.match(/^\/accounts\/([^/]+)\/edit$/);
  if (edit) return { id: edit[1] };
  return {};
}

export function setNav(path: string) {
  const url = new URL(path, "http://localhost");
  nav = {
    pathname: url.pathname,
    search: url.search.startsWith("?") ? url.search.slice(1) : url.search,
    params: parseParams(url.pathname),
  };
  replaceMock.mockClear();
  pushMock.mockClear();
  notify();
}

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
    replace: replaceMock,
    back: vi.fn(),
    prefetch: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
  useParams: () => nav.params,
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
    onClick,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
    onClick?: (event: React.MouseEvent<HTMLAnchorElement>) => void;
  }) => (
    <a
      href={typeof href === "string" ? href : "#"}
      className={className}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        event.preventDefault();
        if (typeof href === "string") pushMock(href);
      }}
      {...rest}
    >
      {children}
    </a>
  ),
}));
