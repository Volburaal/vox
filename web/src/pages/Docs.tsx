import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Play, ShieldCheck, ChevronRight } from "lucide-react";
import Nav from "../components/Nav";
import Snippet from "../components/Snippet";
import GithubIcon from "../components/GithubIcon";
import { CATEGORIES, REFERENCE, type DocTable } from "../docs/content";
import { LINKS } from "../site";

/**
 * The language reference. Prose lives in docs/content.ts; every code block is
 * a real program from docs/snippets/ shown next to the output the compiler
 * produced for it.
 */

/** Renders `code spans` inside a sentence. */
function RichText({ text }: { text: string }) {
  return (
    <>
      {text.split(/(`[^`]+`)/g).map((part, i) =>
        part.startsWith("`") && part.endsWith("`") && part.length > 2 ? (
          <code
            key={i}
            className="rounded border border-line-2 bg-panel-2 px-1.5 py-0.5 font-mono text-[0.85em] text-neon-blue-soft"
          >
            {part.slice(1, -1)}
          </code>
        ) : (
          part
        ),
      )}
    </>
  );
}

function Table({ table }: { table: DocTable }) {
  return (
    <div className="mt-5 overflow-x-auto rounded-lg border border-line">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-panel-2">
            {table.head.map((h) => (
              <th
                key={h}
                className="border-b border-line px-4 py-2.5 text-left font-semibold text-paper"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, i) => (
            <tr key={i} className="odd:bg-panel/60">
              {row.map((cell, j) => (
                <td
                  key={j}
                  className="border-b border-line px-4 py-2.5 align-top text-fog last:border-r-0"
                >
                  <RichText text={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Highlights the section currently under the top of the viewport. */
function useScrollSpy(ids: string[]): string {
  const [active, setActive] = useState(ids[0] ?? "");
  const visible = useRef(new Set<string>());

  useEffect(() => {
    const seen = visible.current;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) seen.add(entry.target.id);
          else seen.delete(entry.target.id);
        }
        // The earliest section still on screen is the one being read.
        const current = ids.find((id) => seen.has(id));
        if (current) setActive(current);
      },
      // A band just below the sticky header, so the active item tracks reading.
      { rootMargin: "-72px 0px -65% 0px" },
    );

    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [ids]);

  return active;
}

const SECTION_IDS = CATEGORIES.flatMap((c) => c.sections.map((s) => s.id));

export default function Docs() {
  const active = useScrollSpy(SECTION_IDS);

  return (
    <div className="neon-backdrop min-h-full">
      <Nav />

      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <header className="border-b border-line py-12">
          <h1 className="text-4xl font-bold tracking-tight text-neon-red-soft glow-red sm:text-5xl">
            Documentation
          </h1>
          {/* <p className="mt-4 max-w-2xl text-lg text-fog">
            Every feature of the language, with a program you can run and the
            output it produced.
          </p>

          <div className="mt-6 flex max-w-2xl items-start gap-3 rounded-lg border border-line bg-panel/60 p-4">
            <ShieldCheck
              size={18}
              className="mt-0.5 shrink-0 text-neon-blue-soft"
            />
            <p className="text-sm leading-relaxed text-fog">
              The examples on this page are not written by hand. Each one is a
              real program in{" "}
              <code className="font-mono text-paper">docs/snippets/</code>, run
              by the regression suite on{" "}
              <span className="text-paper">both engines</span> - the Java
              reference implementation and the TypeScript port - and checked
              against the output shown here. If the language changes, this page
              fails the build.
            </p>
          </div> */}

          <div className="mt-6 flex flex-wrap gap-3">
            <Link to="/playground" className="btn-red">
              <Play size={16} />
              Open the playground
            </Link>
            <a
              href={LINKS.github}
              target="_blank"
              rel="noreferrer"
              className="btn-ghost"
            >
              <GithubIcon size={16} />
              Source
            </a>
          </div>
        </header>

        {/* Category jump list, for viewports without the sidebar. */}
        <nav className="flex flex-wrap gap-2 border-b border-line py-4 lg:hidden">
          {CATEGORIES.map((c) => (
            <a
              key={c.id}
              href={`#${c.sections[0].id}`}
              className="rounded-md border border-line-2 px-3 py-1.5 text-xs text-fog hover:border-fog hover:text-paper"
            >
              {c.title}
            </a>
          ))}
        </nav>

        <div className="lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-12">
          <aside className="sticky top-14 hidden max-h-[calc(100vh-3.5rem)] self-start overflow-y-auto py-10 lg:block">
            <nav className="space-y-6 text-sm">
              {CATEGORIES.map((category) => (
                <div key={category.id}>
                  <div className="panel-title mb-2">{category.title}</div>
                  <ul className="space-y-1 border-l border-line">
                    {category.sections.map((section) => (
                      <li key={section.id}>
                        <a
                          href={`#${section.id}`}
                          className={`-ml-px block border-l py-1 pl-3 transition-colors ${
                            active === section.id
                              ? "border-neon-red text-neon-red-soft"
                              : "border-transparent text-fog hover:border-line-2 hover:text-paper"
                          }`}
                        >
                          {section.title}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              <div>
                <div className="panel-title mb-2">Reference</div>
                <ul className="space-y-1 border-l border-line">
                  {REFERENCE.map((ref) => (
                    <li key={ref.id}>
                      <a
                        href={`#${ref.id}`}
                        className="-ml-px block border-l border-transparent py-1 pl-3 text-fog transition-colors hover:border-line-2 hover:text-paper"
                      >
                        {ref.title}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            </nav>
          </aside>

          <main className="min-w-0 pb-20">
            {CATEGORIES.map((category) => (
              <div key={category.id}>
                <div className="flex items-baseline gap-3 pt-14 pb-2">
                  <h2 className="text-2xl font-bold text-paper">
                    {category.title}
                  </h2>
                  <span className="text-sm text-fog">{category.intro}</span>
                </div>

                {category.sections.map((section) => (
                  <section
                    key={section.id}
                    id={section.id}
                    className="scroll-mt-20 border-t border-line py-8"
                  >
                    <h3 className="flex items-center gap-2 text-xl font-semibold text-neon-blue-soft">
                      <ChevronRight size={16} className="text-fog" />
                      {section.title}
                    </h3>

                    {section.body.map((paragraph, i) => (
                      <p key={i} className="mt-3 leading-relaxed text-fog">
                        <RichText text={paragraph} />
                      </p>
                    ))}

                    {section.snippet && <Snippet id={section.snippet} />}

                    {section.afterBody?.map((paragraph, i) => (
                      <p key={i} className="mt-4 leading-relaxed text-fog">
                        <RichText text={paragraph} />
                      </p>
                    ))}

                    {section.notes && (
                      <ul className="mt-5 space-y-2">
                        {section.notes.map((note, i) => (
                          <li
                            key={i}
                            className="flex gap-2.5 text-sm leading-relaxed text-fog"
                          >
                            <span
                              aria-hidden
                              className="mt-2 h-1 w-1 shrink-0 rounded-full bg-neon-red"
                            />
                            <span>
                              <RichText text={note} />
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}

                    {section.table && <Table table={section.table} />}
                  </section>
                ))}
              </div>
            ))}

            {/* Reference tables */}
            <div className="pt-14 pb-2">
              <h2 className="text-2xl font-bold text-paper">Reference</h2>
            </div>
            {REFERENCE.map((ref) => (
              <section
                key={ref.id}
                id={ref.id}
                className="scroll-mt-20 border-t border-line py-8"
              >
                <h3 className="text-xl font-semibold text-neon-blue-soft">
                  {ref.title}
                </h3>
                {ref.note && (
                  <p className="mt-3 leading-relaxed text-fog">
                    <RichText text={ref.note} />
                  </p>
                )}
                <Table table={ref.table} />
              </section>
            ))}

            <div className="mt-14 rounded-lg border border-line bg-panel/60 p-6">
              <h3 className="font-semibold text-paper">
                That is the whole language.
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-fog">
                Nothing above is a special case bolted onto a runtime: the
                virtual machine has around twenty instructions and every spoken
                form on this page lowers into them. The fastest way to see that
                is to open the playground and watch the IR panel while you type.
              </p>
              <Link to="/playground" className="btn-blue mt-4">
                <Play size={16} />
                Try it
              </Link>
            </div>
          </main>
        </div>
      </div>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-8 text-sm text-fog sm:px-6">
          <span>Vox - made by Muzammil Noor</span>
          <div className="flex gap-4">
            <a
              href={LINKS.journal}
              target="_blank"
              rel="noreferrer"
              className="hover:text-paper"
            >
              Journal
            </a>
            <a
              href={LINKS.github}
              target="_blank"
              rel="noreferrer"
              className="hover:text-paper"
            >
              Source
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
