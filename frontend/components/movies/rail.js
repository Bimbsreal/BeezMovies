import Link from 'next/link';

export function Rail({ title, note, href, children, analytics }) {
  return (
    <section className="page-wrap py-5 md:py-7" data-analytics={analytics || undefined}>
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold tracking-tight text-ink md:text-lg">{title}</h2>
          {note ? <p className="text-xs text-muted">{note}</p> : null}
        </div>
        {href ? (
          <Link href={href} className="text-xs font-medium uppercase tracking-[0.16em] text-honey">
            See all
          </Link>
        ) : null}
      </div>
      <div className="rail-scroller">{children}</div>
    </section>
  );
}
