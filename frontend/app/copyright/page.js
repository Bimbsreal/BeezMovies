import { CopyrightForm } from '../../components/legal/copyright-form';

export const metadata = {
  title: 'Copyright',
  robots: { index: false, follow: false },
};

export default function CopyrightPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10 md:px-8">
      <h1 className="text-3xl font-semibold">Copyright</h1>
      <div className="mt-6 space-y-4 text-sm leading-6 text-muted">
        <p>A listing in the catalog is not a statement that BeezMovies owns the film. Authorized downloads use a stored provider reference. Other copies are not fetched by the application.</p>
        <p>If you are the rights holder, send the movie slug, a short description of the claim, and a contact email. The public response contains only a case code. The contact address is visible to administrators.</p>
      </div>
      <CopyrightForm />
    </main>
  );
}
