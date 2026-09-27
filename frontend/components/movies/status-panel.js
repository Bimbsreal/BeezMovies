export function PlacementSlot({ id }) {
  return <div data-placement={id} hidden />;
}

export function StatusPanel({ title, body, action }) {
  return (
    <section className="page-wrap py-24">
      <p className="text-xs font-medium uppercase tracking-[0.22em] text-honey">BeezMovies</p>
      <h1 className="mt-3 max-w-xl text-3xl font-semibold tracking-tight text-ink">{title}</h1>
      <p className="mt-3 max-w-xl text-base leading-relaxed text-muted">{body}</p>
      {action}
    </section>
  );
}
