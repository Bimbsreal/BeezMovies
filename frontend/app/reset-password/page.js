import { ResetPasswordForm } from '../../components/auth/reset-password-form';

export const metadata = {
  title: 'Reset password',
  robots: { index: false, follow: false },
};

export default function ResetPasswordPage() {
  return <ResetPasswordForm />;
}
