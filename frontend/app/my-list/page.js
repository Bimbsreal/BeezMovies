import { LibraryPage } from '../../components/account/library-page';

export const metadata = {
  title: 'My List',
  robots: { index: false, follow: false },
};

export default function MyListPage() {
  return <LibraryPage title="My List" path="/me/watchlist" removePath="/me/watchlist" empty="Your list is empty." />;
}
