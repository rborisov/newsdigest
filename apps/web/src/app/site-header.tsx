import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

export function SiteHeader({
  brandHref = "/",
  actions,
}: {
  brandHref?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="site-header">
      <Link href={brandHref} className="brand" aria-label="n. home">
        <Image
          src="/logo.png"
          alt=""
          width={36}
          height={36}
          className="brand-logo"
          priority
        />
        <span className="brand-text">
          <span className="brand-name">n.</span>
          <span className="brand-tag">news digest</span>
        </span>
      </Link>
      {actions ? <nav className="nav-actions">{actions}</nav> : null}
    </header>
  );
}
