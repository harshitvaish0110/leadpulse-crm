import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PhoneCall, Mail, Calendar, FileText, MessageSquare, ChevronDown, ChevronRight, Trash2 } from 'lucide-react';
import Avatar from '../ui/Avatar';
import { SentimentBadge } from '../crm/Indicators';
import { formatDate, humanize } from '../../lib/format';

const ACTIVITY_ICONS = { CALL: PhoneCall, EMAIL: Mail, MEETING: Calendar, NOTE: FileText, TRANSCRIPT: MessageSquare };

function TranscriptDetails({ metadata, transcript }) {
  const [open, setOpen] = useState(false);
  const lists = [['Action items', metadata?.actionItems], ['Objections', metadata?.objections], ['Pricing mentions', metadata?.pricingMentions]]
    .filter(([, items]) => Array.isArray(items) && items.length);
  if (!lists.length && !transcript) return null;
  return (
    <div className="mt-2">
      <button onClick={() => setOpen((v) => !v)} aria-expanded={open} className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-700">
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Call details
      </button>
      {open && (
        <div className="mt-2 space-y-2 bg-gray-50 rounded-lg p-3">
          {lists.map(([title, items]) => (
            <div key={title}>
              <p className="text-xs font-semibold text-gray-600">{title}</p>
              <ul className="list-disc ml-4 text-xs text-gray-600">{items.map((item, i) => <li key={i}>{String(item)}</li>)}</ul>
            </div>
          ))}
          {transcript && <p className="text-xs text-gray-500 whitespace-pre-wrap max-h-48 overflow-y-auto">{transcript}</p>}
        </div>
      )}
    </div>
  );
}

/**
 * Chronological list of activities.
 * `showContact` adds the contact link (feeds that span contacts), `showDeal` the deal link,
 * and `onDelete` a delete button per item.
 */
export default function ActivityTimeline({ activities, showContact = false, showDeal = true, onDelete }) {
  return (
    <ol className="relative">
      <div className="absolute left-4 top-0 bottom-0 w-px bg-gray-100" aria-hidden="true" />
      {activities.map((a) => {
        const Icon = ACTIVITY_ICONS[a.type] || PhoneCall;
        return (
          <li key={a.id} className="flex gap-4 pb-5 relative">
            <div className="w-8 h-8 bg-white border-2 border-gray-100 rounded-full flex items-center justify-center flex-shrink-0 z-10" title={humanize(a.type)}>
              <Icon size={14} className="text-indigo-500" />
            </div>
            <div className="flex-1 min-w-0 pt-1">
              <div className="flex items-center gap-2 flex-wrap mb-0.5">
                <span className="text-sm font-medium text-gray-800">{a.subject || humanize(a.type)}</span>
                <SentimentBadge value={a.sentiment} />
                <time className="text-xs text-gray-400 ml-auto" dateTime={a.occurredAt}>{formatDate(a.occurredAt, { hour: 'numeric', minute: '2-digit' })}</time>
                {onDelete && (
                  <button onClick={() => onDelete(a)} aria-label={`Delete ${a.subject || humanize(a.type)}`}
                    className="p-1 text-gray-300 hover:text-red-600 rounded"><Trash2 size={13} /></button>
                )}
              </div>
              <div className="flex items-center gap-2 flex-wrap text-xs text-gray-500">
                {showContact && a.contact && (
                  <Link to={`/contacts/${a.contact.id}`} className="hover:text-indigo-600">{a.contact.firstName} {a.contact.lastName}</Link>
                )}
                {showDeal && a.deal && <Link to={`/deals/${a.deal.id}`} className="hover:text-indigo-600">· {a.deal.title}</Link>}
                {a.durationMinutes ? <span>· {a.durationMinutes} min</span> : null}
                {a.user && (
                  <span className="inline-flex items-center gap-1 ml-auto">
                    <Avatar firstName={a.user.firstName} lastName={a.user.lastName} size="xs" /> {a.user.firstName}
                  </span>
                )}
              </div>
              {a.notes && <p className="text-sm text-gray-600 mt-1 whitespace-pre-wrap line-clamp-4">{a.notes}</p>}
              {a.type === 'TRANSCRIPT' && <TranscriptDetails metadata={a.metadata} transcript={a.transcript} />}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
