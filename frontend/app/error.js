'use client';

import Link from 'next/link';

export default function AppError() {
  return (
    <section className="page-wrap py-24">
      <h1 className="text-3xl font-semibold text-ink">Something went wrong</h1>
      <p className="mt-3 max-w-xl text-muted">BeezMovies could not finish loading this page.</p>
      <Link href="/" className="mt-6 inline-block min-h-11 text-honey">Back to home</Link>
    </section>
  );
}
