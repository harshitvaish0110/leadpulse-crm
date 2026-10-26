import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { UserPlus, Mail, Copy, X, RotateCw, CheckCircle2, AlertTriangle } from 'lucide-react';
import api from '../../api/axiosInstance';
import Button from '../../components/ui/Button';
import Badge from '../../components/ui/Badge';
import Avatar from '../../components/ui/Avatar';
import Modal from '../../components/ui/Modal';
import Input from '../../components/ui/Input';
import Skeleton from '../../components/ui/Skeleton';
import { qk } from '../../hooks/queries/keys';
import toast from 'react-hot-toast';
import { apiError } from '../../lib/apiError';

/** After an invite or resend: whether the email went out, plus the link to share either way. */
function InviteResult({ result, onClose }) {
  const { invitation, inviteUrl, email } = result;
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      toast.success('Invite link copied');
    } catch {
      toast.error('Copy failed — select the link and copy it manually');
    }
  };
  return (
    <div className="space-y-4">
      {email?.sent ? (
        <p className="flex items-start gap-2 text-sm text-green-700 bg-green-50 rounded-lg p-3">
          <CheckCircle2 size={16} className="mt-0.5 flex-shrink-0" />
          <span>
            Invitation emailed to <strong>{invitation.email}</strong>.
            {email.previewUrl && <> <a href={email.previewUrl} target="_blank" rel="noreferrer" className="underline">Open the test inbox</a> to see it.</>}
          </span>
        </p>
      ) : (
        <p className="flex items-start gap-2 text-sm text-amber-800 bg-amber-50 rounded-lg p-3">
          <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
          <span>{email?.error || 'The email could not be sent.'} Share the link below with <strong>{invitation.email}</strong>.</span>
        </p>
      )}
      <div>
        <p className="text-xs text-gray-500 mb-1">Single-use link, valid for 72 hours:</p>
        <div className="flex gap-2">
          <input readOnly value={inviteUrl} onFocus={e => e.target.select()} aria-label="Invite link"
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-xs text-gray-700 bg-gray-50" />
          <Button variant="secondary" onClick={copyLink}><Copy size={14} className="mr-1.5" /> Copy</Button>
        </div>
      </div>
      <Button onClick={onClose} className="w-full">Done</Button>
    </div>
  );
}

function InviteModal({ onClose }) {
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('SALES_REP');
  const [result, setResult] = useState(null);
  const invite = useMutation({
    mutationFn: () => api.post('/api/users/invite', { email, role }).then((r) => r.data),
    onSuccess: (data) => { setResult(data); qc.invalidateQueries({ queryKey: qk.users.all }); },
    onError: (err) => toast.error(apiError(err, 'Failed to create invitation')),
  });

  if (result) return <InviteResult result={result} onClose={onClose} />;

  const handleSubmit = (e) => {
    e.preventDefault();
    invite.mutate();
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
        <Button type="submit" loading={invite.isPending} className="flex-1">
          <Mail size={14} className="mr-1.5" /> Send invitation
        </Button>
      </div>
    </form>
  );
}

export default function UsersSettings() {
  const qc = useQueryClient();
  const [showInvite, setShowInvite] = useState(false);
  const [resent, setResent] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: qk.users.all,
    queryFn: () => api.get('/api/users').then(r => r.data),
  });

  const updateRoleMutation = useMutation({
    mutationFn: ({ id, role }) => api.patch(`/api/users/${id}`, { role }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: qk.users.all }); toast.success('Role updated'); },
    onError: (err) => toast.error(err.response?.data?.error || 'Failed to update role'),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, isActive }) => api.patch(`/api/users/${id}`, { isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.users.all }),
    onError: (err) => toast.error(err.response?.data?.error || 'Failed to update user'),
  });

  const revokeInviteMutation = useMutation({
    mutationFn: (id) => api.delete(`/api/users/invitations/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: qk.users.all }); toast.success('Invitation revoked'); },
    onError: () => toast.error('Failed to revoke invitation'),
  });

  const resendMutation = useMutation({
    mutationFn: (id) => api.post(`/api/users/invitations/${id}/resend`).then((r) => r.data),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: qk.users.all });
      if (data.email?.sent) toast.success(`Invitation emailed again to ${data.invitation.email}`);
      else setResent(data);
    },
    onError: (err) => toast.error(apiError(err, 'Failed to resend the invitation')),
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
                {['Member', 'Email', 'Role', 'Active'].map(h => (
                  <th key={h} className="text-left text-xs font-semibold text-gray-500 px-5 py-3 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {users.length === 0 ? (
                <tr><td colSpan={4} className="px-5 py-12 text-center text-sm text-gray-400">No users yet</td></tr>
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
                      aria-label={`Role of ${u.firstName} ${u.lastName}`}
                      onChange={e => updateRoleMutation.mutate({ id: u.id, role: e.target.value })}
                      className="text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                    >
                      <option value="SALES_REP">Sales Rep</option>
                      <option value="MANAGER">Manager</option>
                      <option value="ADMIN">Admin</option>
                    </select>
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
                  <p className="text-sm text-gray-900 flex items-center gap-2">
                    {inv.email}
                    {inv.expired && <Badge variant="amber">Expired</Badge>}
                  </p>
                  <p className="text-xs text-gray-400">
                    {inv.role.replace('_', ' ')} · {inv.expired ? 'expired' : 'expires'} {new Date(inv.expiresAt).toLocaleString()}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="sm" onClick={() => resendMutation.mutate(inv.id)}
                    loading={resendMutation.isPending && resendMutation.variables === inv.id}>
                    <RotateCw size={13} className="mr-1" /> Resend
                  </Button>
                  <button
                    onClick={() => revokeInviteMutation.mutate(inv.id)}
                    aria-label={`Revoke invitation for ${inv.email}`}
                    className="p-1.5 text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50 transition-colors">
                    <X size={14} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Modal isOpen={showInvite} onClose={() => setShowInvite(false)} title="Invite Team Member">
        <InviteModal onClose={() => setShowInvite(false)} />
      </Modal>
      <Modal isOpen={Boolean(resent)} onClose={() => setResent(null)} title="Invitation renewed">
        {resent && <InviteResult result={resent} onClose={() => setResent(null)} />}
      </Modal>
    </div>
  );
}
