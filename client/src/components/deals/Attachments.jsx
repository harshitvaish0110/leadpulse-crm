import { useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Paperclip, Download, Trash2, Upload } from 'lucide-react';
import api, { API_BASE } from '../../api/axiosInstance';
import Button from '../ui/Button';
import { formatDate } from '../../lib/format';
import toast from 'react-hot-toast';

const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPT = '.pdf,.txt,.csv,.png,.jpg,.jpeg,.gif,.webp,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip';

const formatSize = (bytes) => (bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/** Files attached to a deal or a contact (pass exactly one of `dealId` / `contactId`). */
export default function Attachments({ dealId, contactId }) {
  const qc = useQueryClient();
  const input = useRef(null);
  const params = dealId ? { dealId } : { contactId };
  const key = ['attachments', params];

  const { data: files = [] } = useQuery({
    queryKey: key,
    queryFn: () => api.get('/api/attachments', { params }).then((r) => r.data.attachments),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: key });

  const upload = useMutation({
    mutationFn: (file) => {
      const form = new FormData();
      form.append('file', file);
      Object.entries(params).forEach(([k, v]) => form.append(k, v));
      return api.post('/api/attachments', form);
    },
    onSuccess: () => { refresh(); toast.success('File attached'); },
    onError: (err) => toast.error(err.response?.data?.details?.[0]?.msg || err.response?.data?.error || 'Upload failed'),
  });
  const remove = useMutation({
    mutationFn: (id) => api.delete(`/api/attachments/${id}`),
    onSuccess: refresh,
    onError: () => toast.error('Could not delete the file'),
  });

  const onPick = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_BYTES) { toast.error('Files can be at most 10 MB'); return; }
    upload.mutate(file);
  };

  const download = async (id) => {
    try {
      const { data } = await api.get(`/api/attachments/${id}/url`);
      // The file is served as an attachment, so following the link downloads it in place.
      Object.assign(document.createElement('a'), { href: data.url.startsWith('http') ? data.url : `${API_BASE}${data.url}`, rel: 'noopener' }).click();
    } catch {
      toast.error('Could not create a download link');
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2"><Paperclip size={14} /> Attachments</h2>
        <Button size="sm" variant="secondary" loading={upload.isPending} onClick={() => input.current?.click()}>
          <Upload size={13} className="mr-1" /> Upload
        </Button>
        <input ref={input} type="file" accept={ACCEPT} className="sr-only" onChange={onPick} aria-label="Upload attachment" />
      </div>
      {files.length === 0 ? (
        <p className="text-xs text-gray-400">No files yet · PDF, images, Office documents, up to 10 MB</p>
      ) : (
        <ul className="divide-y divide-gray-50">
          {files.map((f) => (
            <li key={f.id} className="flex items-center gap-2 py-2">
              <span className="flex-1 min-w-0">
                <span className="block text-sm text-gray-800 truncate" title={f.fileName}>{f.fileName}</span>
                <span className="block text-xs text-gray-400">{formatSize(f.sizeBytes)} · {formatDate(f.createdAt)}{f.uploadedBy ? ` · ${f.uploadedBy.firstName}` : ''}</span>
              </span>
              <button onClick={() => download(f.id)} aria-label={`Download ${f.fileName}`} className="p-1.5 text-gray-400 hover:text-indigo-600 rounded-lg hover:bg-indigo-50">
                <Download size={14} />
              </button>
              <button onClick={() => { if (confirm(`Delete ${f.fileName}?`)) remove.mutate(f.id); }} aria-label={`Delete ${f.fileName}`}
                className="p-1.5 text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50">
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
