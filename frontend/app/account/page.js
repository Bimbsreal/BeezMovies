import { AccountHome } from '../../components/account/account-home';

export const metadata = {
  title: 'Account',
  robots: { index: false, follow: false },
};

export default function AccountPage() {
  return <AccountHome />;
}
