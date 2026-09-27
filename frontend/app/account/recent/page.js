import { LibraryPage } from '../../../components/account/library-page';

export const metadata = {
  title: 'Recently viewed',
  robots: { index: false, follow: false },
};

export default function RecentPage() {
  return (
    <LibraryPage
      title="Watch history"
      path="/me/recent"
      removePath="/me/recent"
      clearPath="/me/recent"
      empty="Nothing viewed in this account yet. Opening a movie while signed in adds it here."
    />
  );
}
