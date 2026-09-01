import { Link, NavLink } from "react-router-dom";
import { BookOpen } from "lucide-react";
import GithubIcon from "./GithubIcon";
import { LINKS } from "../site";

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-1.5 rounded-md px-3 py-1.5 transition-colors ${
    isActive ? "text-neon-blue-soft glow-blue" : "text-fog hover:text-paper"
  }`;

export default function Nav() {
  return (
    <header className="shrink-0 border-b border-line bg-ink/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
        <Link to="/" className="flex items-center gap-3">
          <img
            src="/vox.png"
            alt=""
            className="h-9 w-auto drop-shadow-[0_0_8px_rgba(255,43,43,0.55)]"
          />
          <span className="text-xl font-bold tracking-wide text-neon-red-soft glow-red">
            Vox
          </span>
        </Link>

        <nav className="flex items-center gap-1 text-sm">
          <NavLink to="/docs" className={linkClass}>
            Docs
          </NavLink>
          <NavLink to="/playground" className={linkClass}>
            Playground
          </NavLink>
          <a
            href={LINKS.journal}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-fog transition-colors hover:text-paper"
          >
            <BookOpen size={15} />
            <span className="hidden sm:inline">Story</span>
          </a>
          <a
            href={LINKS.github}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-fog transition-colors hover:text-paper"
          >
            <GithubIcon size={15} />
            <span className="hidden sm:inline">GitHub</span>
          </a>
        </nav>
      </div>
    </header>
  );
}
