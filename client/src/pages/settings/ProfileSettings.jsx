import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import api from '../../api/axiosInstance';
import { useAuthStore } from '../../store/authStore';
import Input from '../../components/ui/Input';
import Button from '../../components/ui/Button';
import Badge from '../../components/ui/Badge';
import { humanize } from '../../lib/format';
import toast from 'react-hot-toast';
import { apiError } from '../../lib/apiError';


function ProfileForm({ user }) {
  const updateUser = useAuthStore((s) => s.updateUser);
  const [form, setForm] = useState({ firstName: user.firstName, lastName: user.lastName, email: user.email });
  const set = (field) => (e) => setForm((p) => ({ ...p, [field]: e.target.value }));

  const save = useMutation({
    mutationFn: (data) => api.patch('/api/auth/me', data).then((r) => r.data.user),
    onSuccess: (saved) => { updateUser({ ...user, ...saved }); toast.success('Profile updated'); },
    onError: (err) => toast.error(apiError(err, 'Could not update your profile')),
  });

  return (
    <form onSubmit={(e) => { e.preventDefault(); save.mutate(form); }} className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-900">Your profile</h2>
        <Badge variant="indigo">{humanize(user.role)}</Badge>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Input label="First name" required value={form.firstName} onChange={set('firstName')} />
        <Input label="Last name" required value={form.lastName} onChange={set('lastName')} />
      </div>
      <Input label="Email" type="email" required value={form.email} onChange={set('email')} />
      <div className="flex justify-end">
        <Button type="submit" loading={save.isPending}>Save profile</Button>
      </div>
    </form>
  );
}

function PasswordForm() {
  const setToken = useAuthStore((s) => s.setToken);
  const empty = { currentPassword: '', newPassword: '', confirm: '' };
  const [form, setForm] = useState(empty);
  const set = (field) => (e) => setForm((p) => ({ ...p, [field]: e.target.value }));

  const change = useMutation({
    mutationFn: ({ currentPassword, newPassword }) => api.post('/api/auth/change-password', { currentPassword, newPassword }).then((r) => r.data),
    onSuccess: (data) => {
      // Other sessions are signed out; this one continues with the new token.
      if (data.accessToken) setToken(data.accessToken);
      setForm(empty);
      toast.success('Password changed. Other devices have been signed out.');
    },
    onError: (err) => toast.error(apiError(err, 'Could not change your password')),
  });

  const submit = (e) => {
    e.preventDefault();
    if (form.newPassword !== form.confirm) { toast.error('New passwords do not match'); return; }
    change.mutate(form);
  };

  return (
    <form onSubmit={submit} className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 space-y-4">
      <h2 className="text-base font-semibold text-gray-900">Change password</h2>
      <Input label="Current password" type="password" autoComplete="current-password" required value={form.currentPassword} onChange={set('currentPassword')} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Input label="New password" type="password" autoComplete="new-password" required value={form.newPassword} onChange={set('newPassword')}
          placeholder="8+ characters, an uppercase letter and a number" />
        <Input label="Confirm new password" type="password" autoComplete="new-password" required value={form.confirm} onChange={set('confirm')} />
      </div>
      <div className="flex justify-end">
        <Button type="submit" loading={change.isPending}>Change password</Button>
      </div>
    </form>
  );
}

export default function ProfileSettings() {
  const user = useAuthStore((s) => s.user);
  if (!user) return null;
  return (
    <div className="max-w-2xl space-y-6">
      <ProfileForm key={user.id} user={user} />
      <PasswordForm />
    </div>
  );
}
