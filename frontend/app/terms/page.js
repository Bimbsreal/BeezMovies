export const metadata = {
  title: 'Terms',
  description: 'How BeezMovies presents catalog records and authorized media.',
};

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10 md:px-8">
      <h1 className="text-3xl font-semibold">Terms</h1>
      <div className="mt-6 space-y-4 text-sm leading-6 text-muted">
        <p>This page is a product notice, not a completed legal agreement. Counsel should review it before production use.</p>
        <p>A catalog page describes a movie. It does not by itself mean a downloadable file is available. Download is offered only for a media reference marked authorized. BeezMovies does not store movie files on the application server.</p>
        <p>Accounts are optional. You are responsible for the password on an account you create. Administrators can unpublish a title or disable a media reference without deleting the catalog record.</p>
      </div>
    </main>
  );
}
