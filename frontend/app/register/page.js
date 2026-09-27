import { RegisterForm } from '../../components/auth/register-form';

export const metadata = {
  title: 'Create account',
  robots: { index: false, follow: false },
};

export default function RegisterPage() {
  return <RegisterForm />;
}
