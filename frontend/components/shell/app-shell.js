import { AuthProvider } from '../auth/auth-provider';
import { MonetizationProvider } from '../monetization/monetization-provider';
import { ShellFrame } from './shell-frame';

export function AppShell({ children }) {
  return (
    <AuthProvider>
      <MonetizationProvider>
        <ShellFrame>{children}</ShellFrame>
      </MonetizationProvider>
    </AuthProvider>
  );
}
