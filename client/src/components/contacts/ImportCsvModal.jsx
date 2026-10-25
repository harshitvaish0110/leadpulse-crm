import { useState } from 'react';
import Papa from 'papaparse';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Upload, CheckCircle2, AlertTriangle } from 'lucide-react';
import api from '../../api/axiosInstance';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import { IMPORT_FIELDS, applyMapping, guessMapping, missingRequired } from '../../lib/csvMapping';
import { qk } from '../../hooks/queries/keys';
import toast from 'react-hot-toast';

const MAX_ROWS = 5000;

/** Step 1: pick a file. Step 2: map columns and preview. Step 3: results. */
export default function ImportCsvModal({ isOpen, onClose }) {
  const qc = useQueryClient();
  const [parsed, setParsed] = useState(null); // { fileName, headers, rows }
  const [mapping, setMapping] = useState({});
  const [result, setResult] = useState(null);

  const reset = () => { setParsed(null); setMapping({}); setResult(null); };
  const close = () => { reset(); onClose(); };

  const onFile = (file) => {
    if (!file) return;
    Papa.parse(file, {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (h) => h.trim(),
      complete: ({ data, meta, errors }) => {
        if (errors.length && !data.length) { toast.error('Could not read this file as CSV'); return; }
        const headers = (meta.fields || []).filter(Boolean);
        if (!headers.length) { toast.error('The first row should contain column names'); return; }
        if (data.length > MAX_ROWS) { toast.error(`At most ${MAX_ROWS.toLocaleString()} rows per import (this file has ${data.length.toLocaleString()})`); return; }
        setParsed({ fileName: file.name, headers, rows: data });
        setMapping(guessMapping(headers));
      },
      error: () => toast.error('Could not read this file'),
    });
  };

  const importRows = useMutation({
    mutationFn: (rows) => api.post('/api/contacts/import', { rows }).then((r) => r.data),
    onSuccess: (data) => {
      setResult(data);
      qc.invalidateQueries({ queryKey: qk.contacts.all });
    },
    onError: (err) => toast.error(err.response?.data?.details?.[0]?.msg || err.response?.data?.error || 'Import failed'),
  });

  const setField = (header, field) => setMapping((m) => {
    // A field can only come from one column.
    const next = Object.fromEntries(Object.entries(m).map(([h, f]) => [h, f === field && field ? '' : f]));
    next[header] = field;
    return next;
  });

  const missing = parsed ? missingRequired(mapping) : [];

  return (
    <Modal isOpen={isOpen} onClose={close} title="Import contacts from CSV" size="xl">
      {!parsed && (
        <label className="flex flex-col items-center justify-center gap-3 border-2 border-dashed border-gray-200 rounded-xl py-12 cursor-pointer hover:border-indigo-300 hover:bg-indigo-50/40 transition-colors">
          <Upload size={24} className="text-indigo-500" />
          <span className="text-sm font-medium text-gray-700">Choose a CSV file</span>
          <span className="text-xs text-gray-400">The first row must contain column names · up to {MAX_ROWS.toLocaleString()} rows</span>
          <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
        </label>
      )}

      {parsed && !result && (
        <div className="space-y-5">
          <p className="text-sm text-gray-600">
            <strong>{parsed.fileName}</strong> · {parsed.rows.length.toLocaleString()} rows. Choose which field each column goes into.
            Existing contacts (matched by email) only get their empty fields filled.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {parsed.headers.map((header) => (
              <label key={header} className="flex items-center gap-3 text-sm">
                <span className="w-1/2 truncate font-medium text-gray-700" title={header}>{header}</span>
                <select value={mapping[header] || ''} onChange={(e) => setField(header, e.target.value)}
                  className="w-1/2 border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                  <option value="">Don't import</option>
                  {IMPORT_FIELDS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                </select>
              </label>
            ))}
          </div>

          <div className="overflow-x-auto border border-gray-100 rounded-xl">
            <table className="w-full text-xs">
              <caption className="text-left text-xs font-semibold text-gray-500 px-3 py-2">Preview (first 5 rows, as they will be imported)</caption>
              <thead className="bg-gray-50">
                <tr>{IMPORT_FIELDS.map((f) => <th key={f.key} className="text-left px-3 py-2 font-semibold text-gray-500">{f.label.split(' (')[0]}</th>)}</tr>
              </thead>
              <tbody>
                {applyMapping(parsed.rows.slice(0, 5), mapping).map((row, i) => (
                  <tr key={i} className="border-t border-gray-50">
                    {IMPORT_FIELDS.map((f) => <td key={f.key} className="px-3 py-2 text-gray-700 whitespace-nowrap">{row[f.key] || <span className="text-gray-300">—</span>}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {missing.length > 0 && (
            <p className="text-sm text-amber-700 bg-amber-50 rounded-lg px-3 py-2" role="status">
              Map a column to: {missing.map((f) => f.label).join(', ')}
            </p>
          )}

          <div className="flex gap-3 justify-end">
            <Button variant="secondary" onClick={reset}>Choose another file</Button>
            <Button disabled={missing.length > 0} loading={importRows.isPending}
              onClick={() => importRows.mutate(applyMapping(parsed.rows, mapping))}>
              Import {parsed.rows.length.toLocaleString()} rows
            </Button>
          </div>
        </div>
      )}

      {result && (
        <div className="space-y-4">
          <div className="flex items-start gap-3 bg-green-50 rounded-xl p-4">
            <CheckCircle2 size={18} className="text-green-600 mt-0.5" />
            <p className="text-sm text-green-800">
              {result.created} created · {result.updated} updated{result.failed.length ? ` · ${result.failed.length} skipped` : ''}
            </p>
          </div>
          {result.failed.length > 0 && (
            <div className="border border-amber-100 rounded-xl">
              <p className="flex items-center gap-2 text-sm font-medium text-amber-800 px-4 py-2 bg-amber-50 rounded-t-xl">
                <AlertTriangle size={14} /> Rows that were not imported
              </p>
              <ul className="max-h-48 overflow-y-auto text-sm divide-y divide-gray-50">
                {result.failed.slice(0, 100).map((f) => (
                  <li key={f.row} className="px-4 py-2 text-gray-700">Row {f.row + 1}: {f.reason}</li>
                ))}
              </ul>
              {result.failed.length > 100 && <p className="px-4 py-2 text-xs text-gray-400">…and {result.failed.length - 100} more</p>}
            </div>
          )}
          <div className="flex justify-end"><Button onClick={close}>Done</Button></div>
        </div>
      )}
    </Modal>
  );
}
