import type { SVGProps } from "react";

function Icon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    />
  );
}

export const HomeIcon = () => (
  <Icon>
    <path d="M3 11l9-8 9 8" />
    <path d="M5 10v10h14V10" />
  </Icon>
);

export const ListIcon = () => (
  <Icon>
    <path d="M8 6h13M8 12h13M8 18h13" />
    <path d="M3 6h.01M3 12h.01M3 18h.01" />
  </Icon>
);

export const PlusIcon = () => (
  <Icon strokeWidth="2.5">
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

export const WalletIcon = () => (
  <Icon>
    <path d="M3 7a2 2 0 0 1 2-2h14v4" />
    <path d="M3 7v11a2 2 0 0 0 2 2h16V9H5a2 2 0 0 1-2-2z" />
    <path d="M17 14h.01" />
  </Icon>
);

export const MenuIcon = () => (
  <Icon>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Icon>
);
