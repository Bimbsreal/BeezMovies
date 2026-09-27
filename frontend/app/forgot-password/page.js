import { ForgotPasswordForm } from '../../components/auth/forgot-password-form';

export const metadata = {
  title: 'Forgot password',
  robots: { index: false, follow: false },
};

export default function ForgotPasswordPage() {
  return <ForgotPasswordForm />;
}
