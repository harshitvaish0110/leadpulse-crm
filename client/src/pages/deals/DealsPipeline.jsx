import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, GripVertical } from 'lucide-react';
import { DndContext, DragOverlay, closestCorners, PointerSensor, useDroppable, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { getDeals, createDeal, updateDealStage } from '../../api/deals';
import { getContacts } from '../../api/contacts';
import Button from '../../components/ui/Button';
import SlideOver from '../../components/ui/SlideOver';
import Input from '../../components/ui/Input';
import Skeleton from '../../components/ui/Skeleton';
import Avatar from '../../components/ui/Avatar';
import { formatCurrency, formatPercent } from '../../lib/format';
import { qk } from '../../hooks/queries/keys';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';

const STAGES = [
  { key: 'LEAD',        label: 'Lead',        color: 'bg-gray-100 text-gray-600' },
  { key: 'CONTACTED',   label: 'Contacted',   color: 'bg-indigo-100 text-indigo-700' },
  { key: 'DEMO',        label: 'Demo',        color: 'bg-purple-100 text-purple-700' },
  { key: 'PROPOSAL',    label: 'Proposal',    color: 'bg-amber-100 text-amber-700' },
  { key: 'NEGOTIATION', label: 'Negotiation', color: 'bg-orange-100 text-orange-700' },
  { key: 'CLOSED_WON',  label: 'Won',         color: 'bg-green-100 text-green-700' },
  { key: 'CLOSED_LOST', label: 'Lost',        color: 'bg-red-100 text-red-700' },
];
const CLOSED = new Set(['CLOSED_WON', 'CLOSED_LOST']);
const KANBAN_PARAMS = { view: 'kanban' };

function DealCard({ deal, isDragging = false }) {
  const navigate = useNavigate();
  const {
    attributes, listeners, setNodeRef, transform, transition, isDragging: sortableDragging,
  } = useSortable({ id: deal.id, data: { stage: deal.stage } });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: sortableDragging ? 0.4 : 1,
  };

  return (
    <div ref={setNodeRef} style={style}
      className={`bg-white rounded-xl border border-gray-100 p-3.5 shadow-sm hover:shadow-md transition-all ${isDragging ? 'shadow-xl rotate-1' : ''}`}>
      <div className="flex items-start justify-between mb-2">
        <p className="text-sm font-medium text-gray-900 cursor-pointer hover:text-indigo-600 flex-1 mr-2"
          onClick={() => navigate(`/deals/${deal.id}`)}>
          {deal.title}
        </p>
        <div {...attributes} {...listeners} aria-label={`Move ${deal.title}`}
          className="cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 flex-shrink-0 mt-0.5">
          <GripVertical size={14} />
        </div>
      </div>
      <p className="text-lg font-bold text-indigo-600 mb-2">{formatCurrency(deal.value)}</p>
      <div className="flex items-center gap-2">
        {deal.contact && (
          <div className="flex items-center gap-1.5">
            <Avatar firstName={deal.contact.firstName} lastName={deal.contact.lastName} size="xs" />
            <span className="text-xs text-gray-400">{deal.contact.firstName} {deal.contact.lastName}</span>
          </div>
        )}
        {!CLOSED.has(deal.stage) && (
          <span className="text-xs text-gray-400 ml-auto" title="Win probability">{formatPercent(deal.winProbability)}</span>
        )}
      </div>
    </div>
  );
}

function KanbanColumn({ stage, deals, onAddDeal }) {
  // A plain droppable, so a column accepts drops even when it has no cards.
  const { setNodeRef, isOver } = useDroppable({ id: stage.key, data: { stage: stage.key } });
  return (
    <div className="flex-shrink-0 w-64 xl:w-72">
      <div className="flex items-center justify-between mb-3 px-1">
        <div className="flex items-center gap-2">
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${stage.color}`}>{stage.label}</span>
          <span className="text-xs text-gray-400 font-medium">{deals.length}</span>
        </div>
        <span className="text-xs text-gray-400">
          {formatCurrency(deals.reduce((s, d) => s + Number(d.value || 0), 0))}
        </span>
      </div>
      <div ref={setNodeRef} data-stage={stage.key}
        className={`rounded-xl p-2 space-y-2 min-h-[120px] transition-colors ${isOver ? 'bg-indigo-50 ring-2 ring-indigo-200' : 'bg-gray-50'}`}>
        <SortableContext items={deals.map(d => d.id)} strategy={verticalListSortingStrategy}>
          {deals.map(deal => <DealCard key={deal.id} deal={deal} />)}
        </SortableContext>
        <button onClick={() => onAddDeal(stage.key)}
          className="w-full flex items-center justify-center gap-1 py-2 text-xs text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors border border-dashed border-gray-200 hover:border-indigo-300">
          <Plus size={13} /> Add deal
        </button>
      </div>
    </div>
  );
}

function AddDealForm({ defaultStage, onClose }) {
  const qc = useQueryClient();
  const { data: contactsData } = useQuery({
    queryKey: qk.contacts.options,
    queryFn: () => getContacts({ limit: 100, sortBy: 'firstName', sortDir: 'asc' }).then(r => r.data),
  });
  const [form, setForm] = useState({ title: '', value: '', stage: defaultStage || 'LEAD', contactId: '' });
  const { mutate, isPending } = useMutation({
    mutationFn: createDeal,
    onSuccess: () => { qc.invalidateQueries({ queryKey: qk.deals.all }); toast.success('Deal created'); onClose(); },
    onError: err => toast.error(err.response?.data?.details?.[0]?.msg || err.response?.data?.error || 'Failed to create deal'),
  });
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  return (
    <form onSubmit={e => { e.preventDefault(); mutate(form); }} className="space-y-4">
      <Input label="Deal title" required value={form.title} onChange={e => set('title', e.target.value)} />
      <Input label="Value ($)" type="number" min="0" value={form.value} onChange={e => set('value', e.target.value)} />
      <div>
        <label htmlFor="deal-stage" className="block text-sm font-medium text-gray-700 mb-1">Stage</label>
        <select id="deal-stage" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          value={form.stage} onChange={e => set('stage', e.target.value)}>
          {STAGES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor="deal-contact" className="block text-sm font-medium text-gray-700 mb-1">Contact</label>
        <select id="deal-contact" required className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          value={form.contactId} onChange={e => set('contactId', e.target.value)}>
          <option value="" disabled>Select a contact</option>
          {(contactsData?.contacts || []).map(c => (
            <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>
          ))}
        </select>
      </div>
      <p className="text-xs text-gray-400">Win probability is calculated automatically from the deal's progress.</p>
      <div className="flex gap-3">
        <Button type="button" variant="secondary" onClick={onClose} className="flex-1">Cancel</Button>
        <Button type="submit" loading={isPending} className="flex-1">Create Deal</Button>
      </div>
    </form>
  );
}

/** Returns a copy of the kanban payload with one deal moved to another column. */
function moveDeal(kanban, dealId, toStage) {
  const next = {};
  let moved = null;
  for (const [stage, column] of Object.entries(kanban)) {
    const deals = column.deals.filter(d => {
      if (d.id !== dealId) return true;
      moved = { ...d, stage: toStage };
      return false;
    });
    next[stage] = { ...column, deals };
  }
  if (!moved) return kanban;
  const target = next[toStage] ?? { deals: [] };
  next[toStage] = { ...target, deals: [moved, ...target.deals] };
  for (const column of Object.values(next)) {
    column.count = column.deals.length;
    column.totalValue = column.deals.reduce((s, d) => s + Number(d.value || 0), 0);
  }
  return next;
}

export default function DealsPipeline() {
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [addStage, setAddStage] = useState('LEAD');
  const [activeId, setActiveId] = useState(null);
  const kanbanKey = qk.deals.kanban(KANBAN_PARAMS);

  const { data, isLoading } = useQuery({
    queryKey: kanbanKey,
    queryFn: () => getDeals(KANBAN_PARAMS).then(r => r.data),
  });

  // Optimistic move: the card jumps immediately and snaps back if the server refuses.
  const stageMutation = useMutation({
    mutationFn: ({ id, stage }) => updateDealStage(id, stage),
    onMutate: async ({ id, stage }) => {
      await qc.cancelQueries({ queryKey: kanbanKey });
      const previous = qc.getQueryData(kanbanKey);
      if (previous?.kanban) qc.setQueryData(kanbanKey, { ...previous, kanban: moveDeal(previous.kanban, id, stage) });
      return { previous };
    },
    onError: (err, _vars, context) => {
      if (context?.previous) qc.setQueryData(kanbanKey, context.previous);
      toast.error(err.response?.data?.error || 'Failed to update deal stage');
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: qk.deals.all });
      qc.invalidateQueries({ queryKey: qk.analytics.all });
    },
  });

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const kanban = data?.kanban || {};
  const allDeals = Object.values(kanban).flatMap(s => s.deals || []);
  const activeDeal = allDeals.find(d => d.id === activeId);

  const handleDragEnd = ({ active, over }) => {
    setActiveId(null);
    if (!over || active.id === over.id) return;
    // `over` is either a column (droppable) or a card inside one; both carry their stage.
    const targetStage = over.data.current?.stage;
    const deal = allDeals.find(d => d.id === active.id);
    if (deal && targetStage && deal.stage !== targetStage) {
      stageMutation.mutate({ id: deal.id, stage: targetStage });
    }
  };

  const totalPipeline = data?.kanban
    ? Object.entries(data.kanban)
        .filter(([k]) => !CLOSED.has(k))
        .reduce((s, [, v]) => s + (v.totalValue || 0), 0)
    : 0;

  const openAdd = (stageKey) => { setAddStage(stageKey); setShowAdd(true); };

  return (
    <div className="space-y-4 -m-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Deals Pipeline</h2>
          <p className="text-sm text-gray-400">{formatCurrency(totalPipeline)} active pipeline</p>
        </div>
        <Button size="sm" onClick={() => openAdd('LEAD')}>
          <Plus size={14} className="mr-1.5" /> Add Deal
        </Button>
      </div>

      {/* Kanban Board */}
      {isLoading ? (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {STAGES.map(s => (
            <div key={s.key} className="flex-shrink-0 w-64">
              <Skeleton className="h-5 w-20 mb-3" />
              <div className="space-y-2">
                {[1,2,3].map(i => <Skeleton key={i} className="h-24 w-full rounded-xl" />)}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={({ active }) => setActiveId(active.id)} onDragEnd={handleDragEnd}>
          <div className="flex gap-4 overflow-x-auto pb-6">
            {STAGES.map(stage => (
              <KanbanColumn
                key={stage.key}
                stage={stage}
                deals={(kanban[stage.key]?.deals || [])}
                onAddDeal={openAdd}
              />
            ))}
          </div>
          <DragOverlay>
            {activeDeal ? <DealCard deal={activeDeal} isDragging /> : null}
          </DragOverlay>
        </DndContext>
      )}

      {/* Add Deal Slide-Over */}
      <SlideOver isOpen={showAdd} onClose={() => setShowAdd(false)} title="Add New Deal">
        <AddDealForm key={addStage} defaultStage={addStage} onClose={() => setShowAdd(false)} />
      </SlideOver>
    </div>
  );
}
