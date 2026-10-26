import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Plus, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../api/axiosInstance';
import Button from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';
import Skeleton from '../../components/ui/Skeleton';
import SectionCard from './SectionCard';
import { DEAL_STAGES } from '../../constants/crm';
import { usePipelineStages } from '../../hooks/queries/lookups';
import { qk } from '../../hooks/queries/keys';
import { apiError } from '../../lib/apiError';
import { humanize } from '../../lib/format';

const control = 'border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500';

function StageRow({ stage, siblings, onSave, onDelete }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: stage.id });
  const [label, setLabel] = useState(stage.label);
  const [color, setColor] = useState(stage.color);
  const lockedBase = stage.dealCount > 0 || siblings <= 1;
  const commitLabel = () => {
    const next = label.trim();
    if (!next) setLabel(stage.label);
    else if (next !== stage.label) onSave({ label: next });
  };

  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex flex-wrap sm:flex-nowrap items-center gap-3 p-3 bg-gray-50 rounded-xl ${isDragging ? 'shadow-lg ring-2 ring-indigo-200 relative z-10' : ''}`}>
      <button type="button" ref={setActivatorNodeRef} {...attributes} {...listeners}
        aria-label={`Reorder ${stage.label}`} className="p-1 text-gray-400 hover:text-gray-600 cursor-grab active:cursor-grabbing touch-none">
        <GripVertical size={16} />
      </button>
      {/* Saved when the picker loses focus: onChange fires on every step of a drag across the palette. */}
      <input type="color" value={color} aria-label={`Colour of ${stage.label}`}
        onChange={(e) => setColor(e.target.value)} onBlur={() => color !== stage.color && onSave({ color })} className="w-8 h-8 rounded border border-gray-200 bg-white p-0.5 cursor-pointer" />
      <input value={label} aria-label="Stage name" maxLength={40} onChange={(e) => setLabel(e.target.value)} onBlur={commitLabel}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
        className={`${control} flex-1 min-w-[8rem] bg-white`} />
      <select value={stage.baseStage} aria-label={`What ${stage.label} counts as`} disabled={lockedBase}
        title={lockedBase ? (stage.dealCount ? 'Move its deals out first' : 'Every base stage needs at least one column') : undefined}
        onChange={(e) => onSave({ baseStage: e.target.value })} className={`${control} bg-white disabled:bg-gray-100 disabled:text-gray-500`}>
        {DEAL_STAGES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
      </select>
      <span className="text-xs text-gray-500 w-16 text-right tabular-nums">{stage.dealCount} {stage.dealCount === 1 ? 'deal' : 'deals'}</span>
      <button type="button" onClick={onDelete} disabled={siblings <= 1} aria-label={`Delete ${stage.label}`}
        title={siblings <= 1 ? `The only ${humanize(stage.baseStage)} column can't be deleted` : undefined}
        className="p-1.5 text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50 disabled:opacity-30 disabled:hover:text-gray-400 disabled:hover:bg-transparent">
        <Trash2 size={14} />
      </button>
    </li>
  );
}

function DeleteStageDialog({ stage, stages, onClose, onConfirm, pending }) {
  const others = stages.filter((s) => s.id !== stage.id);
  const [moveTo, setMoveTo] = useState(() => (others.find((s) => s.baseStage === stage.baseStage) ?? others[0])?.id ?? '');
  return (
    <form onSubmit={(e) => { e.preventDefault(); onConfirm(stage.dealCount ? moveTo : undefined); }} className="space-y-4">
      {stage.dealCount > 0 ? (
        <>
          <p className="text-sm text-gray-600">
            <strong>{stage.label}</strong> holds {stage.dealCount} {stage.dealCount === 1 ? 'deal' : 'deals'}. Choose where they go; each move is recorded in its stage history.
          </p>
          <div>
            <label htmlFor="move-to" className="block text-sm font-medium text-gray-700 mb-1">Move deals to</label>
            <select id="move-to" className={`${control} w-full`} value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
              {others.map((s) => <option key={s.id} value={s.id}>{s.label} ({humanize(s.baseStage)})</option>)}
            </select>
          </div>
        </>
      ) : (
        <p className="text-sm text-gray-600">Delete the empty stage <strong>{stage.label}</strong>?</p>
      )}
      <div className="flex gap-3">
        <Button variant="secondary" className="flex-1" onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="danger" className="flex-1" loading={pending}>Delete stage</Button>
      </div>
    </form>
  );
}

function AddStageForm({ onAdd, pending }) {
  const [form, setForm] = useState({ label: '', baseStage: 'CONTACTED', color: '#6366f1' });
  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));
  return (
    <form className="flex flex-wrap gap-2 mt-4" onSubmit={(e) => {
      e.preventDefault();
      if (form.label.trim()) onAdd(form, () => setForm((p) => ({ ...p, label: '' })));
    }}>
      <input type="color" value={form.color} onChange={set('color')} aria-label="New stage colour" className="w-10 h-10 rounded border border-gray-200 bg-white p-0.5" />
      <input value={form.label} onChange={set('label')} placeholder="New stage name, e.g. Discovery call" aria-label="New stage name" maxLength={40}
        className={`${control} flex-1 min-w-[12rem]`} />
      <select value={form.baseStage} onChange={set('baseStage')} aria-label="New stage counts as" className={control}>
        {DEAL_STAGES.map((s) => <option key={s} value={s}>Counts as {humanize(s)}</option>)}
      </select>
      <Button type="submit" loading={pending}><Plus size={14} className="mr-1" /> Add stage</Button>
    </form>
  );
}

export default function PipelineSettings() {
  const qc = useQueryClient();
  const { data: stages = [], isLoading } = usePipelineStages();
  const [deleting, setDeleting] = useState(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const refresh = () => {
    qc.invalidateQueries({ queryKey: qk.settings.stages });
    qc.invalidateQueries({ queryKey: qk.deals.all }); // board columns and stage labels
  };
  const siblings = (stage) => stages.filter((s) => s.baseStage === stage.baseStage).length;

  const create = useMutation({
    mutationFn: (data) => api.post('/api/settings/pipeline-stages', data),
    onSuccess: () => { refresh(); toast.success('Stage added'); },
    onError: (err) => toast.error(apiError(err, 'Could not add the stage')),
  });
  const update = useMutation({
    mutationFn: ({ id, ...data }) => api.patch(`/api/settings/pipeline-stages/${id}`, data),
    onSuccess: refresh,
    onError: (err) => { toast.error(apiError(err, 'Could not save the stage')); refresh(); },
  });
  const reorder = useMutation({
    mutationFn: (ids) => api.put('/api/settings/pipeline-stages/order', { ids }),
    onMutate: (ids) => {
      const previous = qc.getQueryData(qk.settings.stages);
      qc.setQueryData(qk.settings.stages, ids.map((id) => previous.find((s) => s.id === id)));
      return { previous };
    },
    onError: (err, _ids, ctx) => { qc.setQueryData(qk.settings.stages, ctx.previous); toast.error(apiError(err, 'Could not reorder the stages')); },
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: ({ id, moveTo }) => api.delete(`/api/settings/pipeline-stages/${id}`, { params: moveTo ? { moveTo } : {} }).then((r) => r.data),
    onSuccess: ({ moved }) => { setDeleting(null); refresh(); toast.success(moved ? `Stage deleted; ${moved} deals moved` : 'Stage deleted'); },
    onError: (err) => toast.error(apiError(err, 'Could not delete the stage')),
  });

  const onDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return;
    const ids = stages.map((s) => s.id);
    reorder.mutate(arrayMove(ids, ids.indexOf(active.id), ids.indexOf(over.id)));
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <SectionCard title="Pipeline stages"
        description="The columns of the deal board, in order. Each one counts as a base stage, which drives win probability, forecasts and analytics.">
        {isLoading ? <Skeleton lines={6} /> : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={stages.map((s) => s.id)} strategy={verticalListSortingStrategy}>
              <ol className="space-y-2" aria-label="Pipeline stages">
                {stages.map((stage) => (
                  <StageRow key={`${stage.id}:${stage.label}:${stage.color}`} stage={stage} siblings={siblings(stage)}
                    onSave={(data) => update.mutate({ id: stage.id, ...data })} onDelete={() => setDeleting(stage)} />
                ))}
              </ol>
            </SortableContext>
          </DndContext>
        )}
        <AddStageForm pending={create.isPending} onAdd={(data, reset) => create.mutate(data, { onSuccess: reset })} />
        <p className="text-xs text-gray-500 mt-3">Drag the handle (or focus it and use Space and the arrow keys) to reorder. A base stage can only change on an empty column.</p>
      </SectionCard>

      <Modal isOpen={Boolean(deleting)} onClose={() => setDeleting(null)} title="Delete stage" size="sm">
        {deleting && (
          <DeleteStageDialog key={deleting.id} stage={deleting} stages={stages} pending={remove.isPending}
            onClose={() => setDeleting(null)} onConfirm={(moveTo) => remove.mutate({ id: deleting.id, moveTo })} />
        )}
      </Modal>
    </div>
  );
}
