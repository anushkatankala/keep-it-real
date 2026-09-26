import Link from "next/link";

/** Renders the persistent wordmark and a quiet product descriptor. */
export function Navbar() {
  return (
    <header className="pointer-events-none absolute inset-x-0 top-0 z-40">
      <nav className="mx-auto flex max-w-4xl items-center justify-between px-8 py-7">
        <Link
          className="pointer-events-auto text-xs font-medium tracking-widest text-white"
          href="/"
        >
          KEEP IT REAL
        </Link>
        <span className="text-[10px] uppercase tracking-[0.2em] text-white/25">
          Spatial property system
        </span>
      </nav>
    </header>
  );
}
