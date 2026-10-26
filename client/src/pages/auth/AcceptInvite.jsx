import { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { authApi } from '../../api/axiosInstance';
import Input from '../../components/ui/Input';
import Button from '../../components/ui/Button';
import toast from 'react-hot-toast';

export default function AcceptInvite() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const navigate = useNavigate();
  const setSession = useAuthStore((s) => s.setSession);
  const [form, setForm] = useState({ firstName: '', lastName: '', password: '', confirmPassword: '' });
  const [loading, setLoading] = useState(false);

  const { data: invitation, isLoading, isError } = useQuery({
    queryKey: ['invite', token],
    queryFn: () => authApi.get(`/api/auth/invite/${encodeURIComponent(token)}`).then(r => r.data.invitation),
    enabled: Boolean(token),
    retry: false,
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (form.password !== form.confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }
    setLoading(true);
    try {
      const { firstName, lastName, password } = form;
      const { data } = await authApi.post('/api/auth/accept-invite', { token, firstName, lastName, password });
      setSession(data.accessToken, data.user);
      toast.success(`Welcome to LeadPulse, ${data.user.firstName}!`);
      navigate('/', { replace: true });
    } catch (err) {
      const res = err.response?.data;
      toast.error(res?.details?.[0]?.msg || res?.error || 'Could not accept the invitation');
    } finally {
      setLoading(false);
    }
  };

  const set = (field) => (e) => setForm({ ...form, [field]: e.target.value });

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-indigo-600 rounded-xl mb-4">
            <Sparkles size={24} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Join LeadPulse</h1>
          {invitation && (
            <p className="text-gray-500 text-sm mt-1">
              You were invited as <strong>{invitation.role.replace('_', ' ').toLowerCase()}</strong> ({invitation.email})
            </p>
          )}
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
          {!token || isError ? (
            <div className="text-center space-y-4">
              <p className="text-sm text-gray-600">This invitation link is invalid, already used or has expired.</p>
              <p className="text-sm text-gray-500">Ask your workspace admin for a new invite.</p>
              <Link to="/login" className="text-indigo-600 font-medium hover:text-indigo-700 text-sm">Go to sign in</Link>
            </div>
          ) : isLoading ? (
            <div className="flex justify-center py-8" role="status">
              <div className="w-8 h-8 rounded-full border-4 border-indigo-200 border-t-indigo-600 animate-spin" />
              <span className="sr-only">Checking invitation…</span>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="flex gap-4">
                <Input label="First name" value={form.firstName} onChange={set('firstName')} required autoFocus className="w-1/2" />
                <Input label="Last name" value={form.lastName} onChange={set('lastName')} required className="w-1/2" />
              </div>
              <Input label="Password" type="password" value={form.password} onChange={set('password')} required
                placeholder="8+ characters, an uppercase letter and a number" />
              <Input label="Confirm password" type="password" value={form.confirmPassword} onChange={set('confirmPassword')} required />
              <Button type="submit" loading={loading} className="w-full" size="lg">Create account</Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
