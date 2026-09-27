import Link from 'next/link';

export default function NotFound() {
  return (
    <section className="page-wrap py-24">
      <h1 className="text-3xl font-semibold text-ink">This page is not available</h1>
      <p className="mt-3 text-muted">The movie or page could not be found.</p>
      <Link href="/" className="mt-6 inline-block min-h-11 text-honey">Back to home</Link>
    </section>
  );
}
