export const metadata = {
  title: 'Privacy',
  description: 'What BeezMovies stores about visitors and accounts.',
};

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10 md:px-8">
      <h1 className="text-3xl font-semibold">Privacy</h1>
      <div className="mt-6 space-y-4 text-sm leading-6 text-muted">
        <p>This page describes the current product behavior. It is not a legal opinion. Qualified counsel should review it before a public launch.</p>
        <p>Browsing, search, movie pages, and authorized download do not require an account. The API keeps a short-lived anonymous analytics record of the page, search text, and download result. It does not store a name, email, or precise location for that activity.</p>
        <p>An optional account stores an email, a password hash, a display name, and the watchlist, favorites, and recent views you choose to save. Those records exist so you can sign in and keep a private list. Settings can clear viewing history without deleting the account. Deleting the account removes those library rows, revokes sessions, replaces the email, and retires the password hash. Security events may keep the time and network address of a login or deletion so abuse can still be investigated.</p>
        <p>The session cookie is HttpOnly. In production it is also Secure and SameSite=Lax.</p>
      </div>
    </main>
  );
}
