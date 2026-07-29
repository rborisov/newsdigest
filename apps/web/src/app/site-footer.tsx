import Link from "next/link";

export function SiteFooter({
  links,
}: {
  links: { href: string; label: string }[];
}) {
  if (links.length === 0) return null;
  return (
    <footer className="site-footer">
      <nav aria-label="Site">
        {links.map((l) => (
          <Link key={l.href} href={l.href} className="footer-link">
            {l.label}
          </Link>
        ))}
      </nav>
    </footer>
  );
}
