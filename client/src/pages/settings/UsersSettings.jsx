import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { UserPlus, Shield, Mail, Copy, X } from 'lucide-react';
import api from '../../api/axiosInstance';
import Button from '../../components/ui/Button';
import Badge from '../../components/ui/Badge';
import Avatar from '../../components/ui/Avatar';
import Modal from '../../components/ui/Modal';
import Input from '../../components/ui/Input';
import Skeleton from '../../components/ui/Skeleton';
import toast from 'react-hot-toast';

const ROLE_VARIANT = { ADMIN: 'indigo', MANAGER: 'purple', SALES_REP: 'gray' };

function InviteModal({ onClose }) {
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('SALES_REP');
  const [loading, setLoading] = useState(false);
  const [inviteUrl, setInviteUrl] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { data } = await api.post('/api/users/invite', { email, role });
      setInviteUrl(data.inviteUrl);
      qc.invalidateQueries({ queryKey: ['users'] });
    } catch (err) {
      const res = err.response?.data;
      toast.error(res?.details?.[0]?.msg || res?.error || 'Failed to create invitation');
    } finally {
      setLoading(false);
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      toast.success('Invite link copied');
    } catch {
      toast.error('Copy failed — select the link and copy it manually');
    }
  };

  // Invites are not emailed yet, so the admin shares the link.
  if (inviteUrl) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-gray-600">
          Share this single-use link with <strong>{email}</strong>. It expires in 72 hours.
        </p>
        <div className="flex gap-2">
          <input readOnly value={inviteUrl} onFocus={e => e.target.select()} aria-label="Invite link"
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-xs text-gray-700 bg-gray-50" />
          <Button type="button" variant="secondary" onClick={copyLink}>
            <Copy size={14} className="mr-1.5" /> Copy
          </Button>
        </div>
        <Button type="button" onClick={onClose} className="w-full">Done</Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input label="Email address" type="email" required value={email}
        onChange={e => setEmail(e.target.value)} placeholder="colleague@company.com" />
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
        <select className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          value={role} onChange={e => setRole(e.target.value)}>
          <option value="SALES_REP">Sales Rep</option>
          <option value="MANAGER">Manager</option>
          <option value="ADMIN">Admin</option>
        </select>
      </div>
      <div className="flex gap-3">
        <Button type="button" variant="secondary" onClick={onClose} className="flex-1">Cancel</Button>
        <Button type="submit" loading={loading} className="flex-1">
          <Mail size={14} className="mr-1.5" /> Create Invite Link
        </Button>
      </div>
    </form>
  );
}

export default function UsersSettings() {
  const qc = useQueryClient();
  const [showInvite, setShowInvite] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get('/api/users').then(r => r.data),
  });

  const updateRoleMutation = useMutation({
    mutationFn: ({ id, role }) => api.patch(`/api/users/${id}`, { role }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); toast.success('Role updated'); },
    onError: (err) => toast.error(err.response?.data?.error || 'Failed to update role'),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, isActive }) => api.patch(`/api/users/${id}`, { isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
    onError: (err) => toast.error(err.response?.data?.error || 'Failed to update user'),
  });

  const revokeInviteMutation = useMutation({
    mutationFn: (id) => api.delete(`/api/users/invitations/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); toast.success('Invitation revoked'); },
    onError: () => toast.error('Failed to revoke invitation'),
  });

  const users = data?.users || [];
  const invitations = data?.invitations || [];

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Team & Users</h2>
          <p className="text-sm text-gray-400">Manage your team members and their access levels</p>
        </div>
        <Button onClick={() => setShowInvite(true)}>
          <UserPlus size={14} className="mr-1.5" /> Invite User
        </Button>
      </div>

      {/* Users Table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="p-6"><Skeleton lines={5} /></div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100">
                {['Member', 'Email', 'Role', 'Status', 'Active', 'Actions'].map(h => (
                  <th key={h} className="text-left text-xs font-semibold text-gray-500 px-5 py-3 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {users.length === 0 ? (
                <tr><td colSpan={6} className="px-5 py-12 text-center text-sm text-gray-400">No users yet</td></tr>
              ) : users.map(u => (
                <tr key={u.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <Avatar firstName={u.firstName} lastName={u.lastName} size="sm" />
                      <div>
                        <p className="text-sm font-medium text-gray-900">{u.firstName} {u.lastName}</p>
                        {u.lastLoginAt && (
                          <p className="text-xs text-gray-400">Last seen {new Date(u.lastLoginAt).toLocaleDateString()}</p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-4 text-sm text-gray-500">{u.email}</td>
                  <td className="px-5 py-4">
                    <select
                      value={u.role}
                      onChange={e => updateRoleMutation.mutate({ id: u.id, role: e.target.value })}
                      className="text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                    >
                      <option value="SALES_REP">Sales Rep</option>
                      <option value="MANAGER">Manager</option>
                      <option value="ADMIN">Admin</option>
                    </select>
                  </td>
                  <td className="px-5 py-4">
                    <Badge variant={ROLE_VARIANT[u.role] || 'gray'}>{u.role.replace('_', ' ')}</Badge>
                  </td>
                  <td className="px-5 py-4">
                    <button
                      role="switch"
                      aria-checked={u.isActive}
                      aria-label={`${u.isActive ? 'Deactivate' : 'Activate'} ${u.firstName} ${u.lastName}`}
                      onClick={() => toggleActiveMutation.mutate({ id: u.id, isActive: !u.isActive })}
                      className={`w-11 h-6 rounded-full transition-colors relative flex-shrink-0
                        ${u.isActive ? 'bg-indigo-600' : 'bg-gray-200'}`}>
                      <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform
                        ${u.isActive ? 'left-[22px]' : 'left-0.5'}`} />
                    </button>
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-1">
                      <button className="p-1.5 text-gray-400 hover:text-indigo-600 rounded-lg hover:bg-indigo-50 transition-colors">
                        <Shield size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {invitations.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <h3 className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider border-b border-gray-100">
            Pending invitations
          </h3>
          <ul className="divide-y divide-gray-50">
            {invitations.map(inv => (
              <li key={inv.id} className="px-5 py-3 flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-900">{inv.email}</p>
                  <p className="text-xs text-gray-400">
                    {inv.role.replace('_', ' ')} · expires {new Date(inv.expiresAt).toLocaleString()}
                  </p>
                </div>
                <button
                  onClick={() => revokeInviteMutation.mutate(inv.id)}
                  aria-label={`Revoke invitation for ${inv.email}`}
                  className="p-1.5 text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50 transition-colors">
                  <X size={14} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Modal isOpen={showInvite} onClose={() => setShowInvite(false)} title="Invite Team Member">
        <InviteModal onClose={() => setShowInvite(false)} />
      </Modal>
    </div>
  );
}
