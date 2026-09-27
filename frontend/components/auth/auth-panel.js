import Link from 'next/link';

export function AuthPanel({ title, children, footer }) {
  return (
    <section className="mx-auto w-full max-w-md px-4 py-12">
      <p className="text-xs font-medium uppercase tracking-[0.28em] text-honey">Account</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight text-ink">{title}</h1>
      <div className="mt-8 rounded-2xl border border-white/10 bg-surface p-5 sm:p-6">
        {children}
      </div>
      {footer ? <div className="mt-5 text-sm text-muted">{footer}</div> : null}
    </section>
  );
}

export function AuthField({ label, ...props }) {
  return (
    <label className="block text-sm text-muted">
      {label}
      <input
        {...props}
        className="mt-1.5 min-h-11 w-full rounded-lg border border-white/10 bg-elevated px-3 py-2.5 text-ink outline-none"
      />
    </label>
  );
}

export function AuthError({ error }) {
  if (!error) return null;
  return (
    <p role="alert" className="rounded-lg border border-honey/30 bg-honey/10 px-3 py-2 text-sm text-ink">
      {error}
    </p>
  );
}

export function AuthButton({ children, pending }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-full bg-honey px-4 py-2.5 text-sm font-semibold text-obsidian disabled:opacity-60"
    >
      {pending ? 'Please wait…' : children}
    </button>
  );
}

export function AuthLinks({ children }) {
  return <div className="flex flex-wrap gap-x-4 gap-y-2">{children}</div>;
}

export function TextLink({ href, children }) {
  return (
    <Link href={href} className="text-honey">
      {children}
    </Link>
  );
}

export function DevelopmentNotice({ label, value }) {
  if (!value) return null;
  return (
    <div className="rounded-lg border border-dashed border-honey/40 bg-obsidian px-3 py-3 text-sm text-muted">
      <p className="font-medium text-honey">Development only</p>
      <p className="mt-1">
        Email delivery is not connected. This {label} is returned by the local API and is omitted in production.
      </p>
      <p className="mt-2 break-all font-mono text-xs text-ink">{value}</p>
    </div>
  );
}
