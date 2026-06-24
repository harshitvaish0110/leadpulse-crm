import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { UserPlus, Shield, Mail, Check, X } from 'lucide-react';
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
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('SALES_REP');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post('/api/users/invite', { email, role });
      toast.success(`Invitation sent to ${email}`);
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to send invitation');
    } finally {
      setLoading(false);
    }
  };

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
          <Mail size={14} className="mr-1.5" /> Send Invitation
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
    onError: () => toast.error('Failed to update role'),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, isActive }) => api.patch(`/api/users/${id}`, { isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
    onError: () => toast.error('Failed to update user'),
  });

  const users = data?.users || [];

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
                      onClick={() => toggleActiveMutation.mutate({ id: u.id, active: !u.active })}
                      className={`w-11 h-6 rounded-full transition-colors relative flex-shrink-0
                        ${u.active !== false ? 'bg-indigo-600' : 'bg-gray-200'}`}>
                      <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform
                        ${u.active !== false ? 'left-[22px]' : 'left-0.5'}`} />
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

      <Modal isOpen={showInvite} onClose={() => setShowInvite(false)} title="Invite Team Member">
        <InviteModal onClose={() => setShowInvite(false)} />
      </Modal>
    </div>
  );
}
