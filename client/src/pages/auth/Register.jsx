import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { authApi } from '../../api/axiosInstance';
import Input from '../../components/ui/Input';
import Button from '../../components/ui/Button';
import toast from 'react-hot-toast';

export default function Register() {
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', password: '', confirmPassword: '' });
  const [loading, setLoading] = useState(false);
  const setSession = useAuthStore((s) => s.setSession);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (form.password !== form.confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }
    setLoading(true);
    try {
      const { firstName, lastName, email, password } = form;
      const { data } = await authApi.post('/api/auth/register', { firstName, lastName, email, password });
      setSession(data.accessToken, data.user);
      toast.success(`Welcome to Leadpulse, ${data.user.firstName}!`);
      navigate('/dashboard', { replace: true });
    } catch (err) {
      const res = err.response?.data;
      toast.error(res?.details?.[0]?.msg || res?.error || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-indigo-600 rounded-xl mb-4">
            <Sparkles size={24} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Create an account</h1>
          <p className="text-gray-500 text-sm mt-1">Join Leadpulse today</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="flex gap-4">
              <Input
                label="First name"
                type="text"
                value={form.firstName}
                onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                required
                autoFocus
                className="w-1/2"
              />
              <Input
                label="Last name"
                type="text"
                value={form.lastName}
                onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                required
                className="w-1/2"
              />
            </div>
            <Input
              label="Email address"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="you@company.com"
              required
            />
            <Input
              label="Password"
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              required
            />
            <Input
              label="Confirm password"
              type="password"
              value={form.confirmPassword}
              onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
              required
            />
            <Button type="submit" loading={loading} className="w-full" size="lg">
              Create account
            </Button>
          </form>

          <p className="text-center text-sm text-gray-500 mt-6">
            Already have an account?{' '}
            <Link to="/login" className="text-indigo-600 font-medium hover:text-indigo-700">Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
