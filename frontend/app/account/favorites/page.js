import { LibraryPage } from '../../../components/account/library-page';

export const metadata = {
  title: 'Favorites',
  robots: { index: false, follow: false },
};

export default function FavoritesPage() {
  return <LibraryPage title="Favorites" path="/me/favorites" removePath="/me/favorites" empty="No favorites yet." />;
}
