import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { Plus, GripVertical, LayoutGrid, List, ArrowUp, ArrowDown, Search } from 'lucide-react';
import {
  DndContext, DragOverlay, closestCorners, pointerWithin, KeyboardSensor, PointerSensor, useDroppable, useSensor, useSensors,
} from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { getDeals, createDeal, moveDeal } from '../../api/deals';
import { getContacts } from '../../api/contacts';
import Button from '../../components/ui/Button';
import SlideOver from '../../components/ui/SlideOver';
import Input from '../../components/ui/Input';
import Skeleton from '../../components/ui/Skeleton';
import Avatar from '../../components/ui/Avatar';
import Badge from '../../components/ui/Badge';
import EmptyState from '../../components/ui/EmptyState';
import { WinProbabilityBar } from '../../components/crm/Indicators';
import LostReasonDialog from '../../components/deals/LostReasonDialog';
import { formatCurrency, formatDate, formatPercent, humanize } from '../../lib/format';
import { qk } from '../../hooks/queries/keys';
import { useDirectory, usePipelineStages } from '../../hooks/queries/lookups';
import { useUrlFilters } from '../../hooks/useUrlFilters';
import { useAuthStore } from '../../store/authStore';
import toast from 'react-hot-toast';

const CLOSED = new Set(['CLOSED_WON', 'CLOSED_LOST']);
const FILTER_DEFAULTS = { view: 'kanban', q: '', owner: '', min: '', max: '', from: '', to: '', sort: 'createdAt:desc', page: '1' };
const control = 'text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white';
const apiError = (err, fallback) => err.response?.data?.details?.[0]?.msg || err.response?.data?.error || fallback;

const filterQuery = (f) => ({
  search: f.q || undefined, ownerId: f.owner || undefined,
  minValue: f.min || undefined, maxValue: f.max || undefined,
  closeFrom: f.from || undefined, closeTo: f.to || undefined,
});

// ── Board ─────────────────────────────────────────────────────────────────────

/**
 * Drop on whatever is under the pointer. Corner distance alone favours very
 * tall columns over the one the pointer is in; it is only the fallback for
 * keyboard dragging, which has no pointer.
 */
const collisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length ? hits : closestCorners(args);
};

function DealCard({ deal, columnId, overlay = false }) {
  const navigate = useNavigate();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: deal.id, data: { columnId } });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 };
  return (
    <div ref={setNodeRef} style={style}
      className={`bg-white rounded-xl border border-gray-100 p-3.5 shadow-sm hover:shadow-md transition-all ${overlay ? 'shadow-xl rotate-1' : ''}`}>
      <div className="flex items-start justify-between mb-2">
        <button className="text-sm font-medium text-gray-900 hover:text-indigo-600 flex-1 mr-2 text-left" onClick={() => navigate(`/deals/${deal.id}`)}>
          {deal.title}
        </button>
        <div {...attributes} {...listeners} aria-label={`Move ${deal.title}`}
          className="cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 flex-shrink-0 mt-0.5 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500">
          <GripVertical size={14} />
        </div>
      </div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-lg font-bold text-indigo-600">{formatCurrency(deal.value)}</p>
        <span className="text-xs text-gray-400" title="Days in this stage">{deal.daysInStage ?? 0}d</span>
      </div>
      {!CLOSED.has(deal.stage) && <div className="mb-2"><WinProbabilityBar value={deal.winProbability} /></div>}
      <div className="flex items-center justify-between gap-2">
        {deal.contact && (
          <span className="flex items-center gap-1.5 min-w-0">
            <Avatar firstName={deal.contact.firstName} lastName={deal.contact.lastName} size="xs" />
            <span className="text-xs text-gray-500 truncate">{deal.contact.firstName} {deal.contact.lastName}</span>
          </span>
        )}
        {deal.owner && (
          <span title={`Owner: ${deal.owner.firstName} ${deal.owner.lastName}`}>
            <Avatar firstName={deal.owner.firstName} lastName={deal.owner.lastName} size="xs" />
          </span>
        )}
      </div>
    </div>
  );
}

function KanbanColumn({ column, onAddDeal }) {
  // A droppable column, so it accepts drops even with no cards in it.
  const { setNodeRef, isOver } = useDroppable({ id: column.stage.id, data: { columnId: column.stage.id } });
  const truncated = column.count > column.deals.length;
  return (
    <div className="flex-shrink-0 w-64 xl:w-72">
      <div className="flex items-center justify-between mb-3 px-1">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: column.stage.color }} aria-hidden="true" />
          <span className="text-sm font-semibold text-gray-700">{column.stage.label}</span>
          <span className="text-xs text-gray-400 font-medium">{column.count}</span>
        </div>
        <span className="text-xs text-gray-400">{formatCurrency(column.totalValue)}</span>
      </div>
      <div ref={setNodeRef} data-stage={column.stage.baseStage} data-stage-id={column.stage.id}
        className={`rounded-xl p-2 space-y-2 min-h-[120px] transition-colors ${isOver ? 'bg-indigo-50 ring-2 ring-indigo-200' : 'bg-gray-50'}`}>
        <SortableContext items={column.deals.map(d => d.id)} strategy={verticalListSortingStrategy}>
          {column.deals.map(deal => <DealCard key={deal.id} deal={deal} columnId={column.stage.id} />)}
        </SortableContext>
        {truncated && <p className="text-xs text-gray-400 text-center py-1">Showing the {column.deals.length} most recent · use the list view for all</p>}
        <button onClick={() => onAddDeal(column.stage)}
          className="w-full flex items-center justify-center gap-1 py-2 text-xs text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors border border-dashed border-gray-200 hover:border-indigo-300">
          <Plus size={13} /> Add deal
        </button>
      </div>
    </div>
  );
}

/** Copy of the board with one deal moved; counts and totals adjusted. */
function moveInColumns(columns, dealId, toColumnId) {
  const from = columns.find(c => c.deals.some(d => d.id === dealId));
  const to = columns.find(c => c.stage.id === toColumnId);
  if (!from || !to || from === to) return columns;
  const deal = from.deals.find(d => d.id === dealId);
  const value = Number(deal.value || 0);
  return columns.map(c => {
    if (c === from) return { ...c, deals: c.deals.filter(d => d.id !== dealId), count: c.count - 1, totalValue: c.totalValue - value };
    if (c === to) {
      const moved = { ...deal, pipelineStageId: to.stage.id, stage: to.stage.baseStage, daysInStage: 0 };
      return { ...c, deals: [moved, ...c.deals], count: c.count + 1, totalValue: c.totalValue + value };
    }
    return c;
  });
}

function KanbanBoard({ filters, onAddDeal }) {
  const qc = useQueryClient();
  const params = { view: 'kanban', ...filterQuery(filters) };
  const key = qk.deals.kanban(params);
  const [activeId, setActiveId] = useState(null);
  const [pendingLost, setPendingLost] = useState(null); // { dealId, columnId }

  const { data, isLoading } = useQuery({
    queryKey: key,
    queryFn: () => getDeals(params).then(r => r.data.columns),
    placeholderData: keepPreviousData,
  });
  const columns = data || [];

  // Optimistic: the card moves immediately and snaps back if the server refuses.
  const move = useMutation({
    mutationFn: ({ dealId, columnId, lostReason }) => moveDeal(dealId, { pipelineStageId: columnId, lostReason }),
    onMutate: async ({ dealId, columnId }) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData(key);
      if (previous) qc.setQueryData(key, moveInColumns(previous, dealId, columnId));
      return { previous };
    },
    onError: (err, _vars, context) => {
      if (context?.previous) qc.setQueryData(key, context.previous);
      toast.error(apiError(err, 'Failed to move the deal'));
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: qk.deals.all });
      qc.invalidateQueries({ queryKey: qk.analytics.all });
    },
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const allDeals = columns.flatMap(c => c.deals);
  const activeDeal = allDeals.find(d => d.id === activeId);

  const onDragEnd = ({ active, over }) => {
    setActiveId(null);
    const columnId = over?.data.current?.columnId;
    const fromId = active.data.current?.columnId;
    if (!columnId || columnId === fromId) return;
    const target = columns.find(c => c.stage.id === columnId);
    if (target?.stage.baseStage === 'CLOSED_LOST') setPendingLost({ dealId: active.id, columnId });
    else move.mutate({ dealId: active.id, columnId });
  };

  if (isLoading) {
    return (
      <div className="flex gap-4 overflow-x-auto pb-4">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="flex-shrink-0 w-64 space-y-2">
            <Skeleton className="h-5 w-24 mb-3" />
            {[1, 2, 3].map(j => <Skeleton key={j} className="h-24 w-full rounded-xl" />)}
          </div>
        ))}
      </div>
    );
  }

  return (
    <>
      <DndContext sensors={sensors} collisionDetection={collisionDetection}
        onDragStart={({ active }) => setActiveId(active.id)} onDragCancel={() => setActiveId(null)} onDragEnd={onDragEnd}>
        <div className="flex gap-4 overflow-x-auto pb-6">
          {columns.map(column => <KanbanColumn key={column.stage.id} column={column} onAddDeal={onAddDeal} />)}
        </div>
        <DragOverlay>{activeDeal ? <DealCard deal={activeDeal} overlay /> : null}</DragOverlay>
      </DndContext>
      <LostReasonDialog key={pendingLost?.dealId ?? 'none'} pending={pendingLost} onCancel={() => setPendingLost(null)}
        onConfirm={(lostReason) => { move.mutate({ ...pendingLost, lostReason }); setPendingLost(null); }} />
    </>
  );
}

// ── List view ─────────────────────────────────────────────────────────────────

function SortHeader({ label, field, sort, onSort, align = 'left' }) {
  const [current, dir] = sort.split(':');
  const active = current === field;
  return (
    <th scope="col" aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'} className={`px-4 py-3 text-${align}`}>
      <button onClick={() => onSort(`${field}:${active && dir === 'desc' ? 'asc' : 'desc'}`)}
        className="inline-flex items-center gap-1 text-xs font-semibold text-gray-500 uppercase tracking-wider hover:text-gray-800">
        {label}{active && (dir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
      </button>
    </th>
  );
}

function DealListView({ filters, setFilters }) {
  const [sortBy, sortDir] = filters.sort.split(':');
  const page = Math.max(1, Number(filters.page) || 1);
  const params = { view: 'list', ...filterQuery(filters), sortBy, sortDir, page, limit: 25 };
  const { data, isLoading } = useQuery({
    queryKey: qk.deals.list(params),
    queryFn: () => getDeals(params).then(r => r.data),
    placeholderData: keepPreviousData,
  });
  const deals = data?.deals || [];
  const meta = data?.meta || {};
  const onSort = (sort) => setFilters({ sort });

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="sticky top-0 bg-white">
            <tr className="border-b border-gray-100">
              <SortHeader label="Deal" field="title" sort={filters.sort} onSort={onSort} />
              <th scope="col" className="text-left text-xs font-semibold text-gray-500 px-4 py-3 uppercase tracking-wider">Contact</th>
              <th scope="col" className="text-left text-xs font-semibold text-gray-500 px-4 py-3 uppercase tracking-wider">Stage</th>
              <SortHeader label="Value" field="value" sort={filters.sort} onSort={onSort} />
              <SortHeader label="Win %" field="winProbability" sort={filters.sort} onSort={onSort} />
              <SortHeader label="Close date" field="expectedCloseDate" sort={filters.sort} onSort={onSort} />
              <SortHeader label="In stage" field="stageChangedAt" sort={filters.sort} onSort={onSort} />
              <th scope="col" className="text-left text-xs font-semibold text-gray-500 px-4 py-3 uppercase tracking-wider">Owner</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {isLoading ? Array.from({ length: 8 }).map((_, i) => (
              <tr key={i}><td colSpan={8} className="px-4 py-3"><Skeleton className="h-4 w-full" /></td></tr>
            )) : deals.length === 0 ? (
              <tr><td colSpan={8}><EmptyState title="No deals match these filters" /></td></tr>
            ) : deals.map(d => (
              <tr key={d.id} className="even:bg-gray-50/50 hover:bg-indigo-50/50">
                <td className="px-4 py-3"><Link to={`/deals/${d.id}`} className="text-sm font-medium text-gray-900 hover:text-indigo-600">{d.title}</Link></td>
                <td className="px-4 py-3 text-sm text-gray-600">{d.contact ? <Link to={`/contacts/${d.contact.id}`} className="hover:text-indigo-600">{d.contact.firstName} {d.contact.lastName}</Link> : '—'}</td>
                <td className="px-4 py-3"><Badge variant="gray">{d.pipelineStage?.label || humanize(d.stage)}</Badge></td>
                <td className="px-4 py-3 text-sm font-medium text-gray-900">{formatCurrency(d.value)}</td>
                <td className="px-4 py-3 text-sm text-gray-600">{CLOSED.has(d.stage) ? '—' : formatPercent(d.winProbability)}</td>
                <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">{d.expectedCloseDate ? formatDate(d.expectedCloseDate, { dateOnly: true }) : '—'}</td>
                <td className="px-4 py-3 text-sm text-gray-500">{d.daysInStage}d</td>
                <td className="px-4 py-3 text-sm text-gray-600">{d.owner ? `${d.owner.firstName} ${d.owner.lastName}` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {meta.totalPages > 1 && (
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100">
          <p className="text-sm text-gray-500">Page {meta.page} of {meta.totalPages} · {meta.total} deals</p>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setFilters({ page: String(page - 1) })}>Previous</Button>
            <Button variant="secondary" size="sm" disabled={page >= meta.totalPages} onClick={() => setFilters({ page: String(page + 1) })}>Next</Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Quick add ────────────────────────────────────────────────────────────────

function AddDealForm({ stage, onClose }) {
  const qc = useQueryClient();
  const { data: stages = [] } = usePipelineStages();
  const { data: contactsData } = useQuery({
    queryKey: qk.contacts.options,
    queryFn: () => getContacts({ limit: 100, sortBy: 'firstName', sortDir: 'asc' }).then(r => r.data),
  });
  const [form, setForm] = useState({ title: '', value: '', pipelineStageId: stage?.id ?? '', contactId: '', expectedCloseDate: '' });
  const set = (k) => (e) => setForm(p => ({ ...p, [k]: e.target.value }));
  const { mutate, isPending } = useMutation({
    mutationFn: createDeal,
    onSuccess: () => { qc.invalidateQueries({ queryKey: qk.deals.all }); toast.success('Deal created'); onClose(); },
    onError: err => toast.error(apiError(err, 'Failed to create deal')),
  });
  return (
    <form onSubmit={e => { e.preventDefault(); mutate({ ...form, pipelineStageId: form.pipelineStageId || undefined, expectedCloseDate: form.expectedCloseDate || undefined }); }} className="space-y-4">
      <Input label="Deal title" required value={form.title} onChange={set('title')} />
      <Input label="Value ($)" type="number" min="0" value={form.value} onChange={set('value')} />
      <div>
        <label htmlFor="deal-stage" className="block text-sm font-medium text-gray-700 mb-1">Stage</label>
        <select id="deal-stage" className={`w-full ${control}`} value={form.pipelineStageId} onChange={set('pipelineStageId')}>
          {stages.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor="deal-contact" className="block text-sm font-medium text-gray-700 mb-1">Contact</label>
        <select id="deal-contact" required className={`w-full ${control}`} value={form.contactId} onChange={set('contactId')}>
          <option value="" disabled>Select a contact</option>
          {(contactsData?.contacts || []).map(c => <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>)}
        </select>
      </div>
      <Input label="Expected close date" type="date" value={form.expectedCloseDate} onChange={set('expectedCloseDate')} />
      <p className="text-xs text-gray-400">Win probability is calculated automatically from the deal's progress.</p>
      <div className="flex gap-3">
        <Button type="button" variant="secondary" onClick={onClose} className="flex-1">Cancel</Button>
        <Button type="submit" loading={isPending} className="flex-1">Create Deal</Button>
      </div>
    </form>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function DealsPipeline() {
  const isPrivileged = useAuthStore((s) => ['ADMIN', 'MANAGER'].includes(s.user?.role));
  const { data: directory = [] } = useDirectory();
  const { data: stages = [] } = usePipelineStages();
  const [filters, setFilters] = useUrlFilters(FILTER_DEFAULTS);
  const [search, setSearch] = useState(filters.q);
  const [addStage, setAddStage] = useState(null); // stage object or 'default'
  const list = filters.view === 'list';
  const hasFilters = ['q', 'owner', 'min', 'max', 'from', 'to'].some(k => filters[k]);

  return (
    <div className="space-y-4 -m-6 p-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-lg font-semibold text-gray-900">Deals Pipeline</h2>
        <div className="flex gap-2">
          <div className="inline-flex rounded-lg border border-gray-200 p-0.5" role="group" aria-label="View">
            <button onClick={() => setFilters({ view: 'kanban' })} aria-pressed={!list}
              className={`px-2.5 py-1.5 rounded-md text-sm flex items-center gap-1 ${!list ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:text-gray-800'}`}>
              <LayoutGrid size={14} /> Board
            </button>
            <button onClick={() => setFilters({ view: 'list' })} aria-pressed={list}
              className={`px-2.5 py-1.5 rounded-md text-sm flex items-center gap-1 ${list ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:text-gray-800'}`}>
              <List size={14} /> List
            </button>
          </div>
          <Button size="sm" onClick={() => setAddStage(stages[0] ?? 'default')}><Plus size={14} className="mr-1.5" /> Add Deal</Button>
        </div>
      </div>

      {/* Filters (kept in the URL) */}
      <form className="flex gap-3 flex-wrap items-end" onSubmit={(e) => { e.preventDefault(); setFilters({ q: search }); }}>
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input aria-label="Search deals" placeholder="Search deals or contacts…" value={search}
            onChange={e => setSearch(e.target.value)} onBlur={() => setFilters({ q: search })}
            className={`${control} pl-9 w-60`} />
        </div>
        {isPrivileged && (
          <select aria-label="Owner" className={control} value={filters.owner} onChange={e => setFilters({ owner: e.target.value })}>
            <option value="">All owners</option>
            {directory.map(u => <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>)}
          </select>
        )}
        <label className="text-xs text-gray-500">Min value
          <input type="number" min="0" className={`${control} block w-28 mt-1`} value={filters.min} onChange={e => setFilters({ min: e.target.value })} />
        </label>
        <label className="text-xs text-gray-500">Max value
          <input type="number" min="0" className={`${control} block w-28 mt-1`} value={filters.max} onChange={e => setFilters({ max: e.target.value })} />
        </label>
        <label className="text-xs text-gray-500">Closing from
          <input type="date" className={`${control} block mt-1`} value={filters.from} onChange={e => setFilters({ from: e.target.value })} />
        </label>
        <label className="text-xs text-gray-500">to
          <input type="date" className={`${control} block mt-1`} value={filters.to} onChange={e => setFilters({ to: e.target.value })} />
        </label>
        {hasFilters && (
          <button type="button" className="text-sm text-indigo-600 hover:text-indigo-700 pb-2"
            onClick={() => { setSearch(''); setFilters({ q: '', owner: '', min: '', max: '', from: '', to: '' }); }}>
            Clear filters
          </button>
        )}
      </form>

      {list
        ? <DealListView filters={filters} setFilters={setFilters} />
        : <KanbanBoard filters={filters} onAddDeal={setAddStage} />}

      <SlideOver isOpen={Boolean(addStage)} onClose={() => setAddStage(null)} title="Add New Deal">
        {addStage && <AddDealForm key={addStage.id ?? 'default'} stage={addStage === 'default' ? null : addStage} onClose={() => setAddStage(null)} />}
      </SlideOver>
    </div>
  );
}
