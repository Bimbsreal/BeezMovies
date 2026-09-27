import { SettingsView } from '../../../components/account/settings-view';

export const metadata = {
  title: 'Settings',
  robots: { index: false, follow: false },
};

export default function SettingsPage() {
  return <SettingsView />;
}
