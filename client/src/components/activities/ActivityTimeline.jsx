import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { PhoneCall, Mail, Calendar, FileText, MessageSquare, ChevronDown, ChevronRight, Trash2, RotateCcw } from 'lucide-react';
import Avatar from '../ui/Avatar';
import { SentimentBadge } from '../crm/Indicators';
import { formatDate, humanize } from '../../lib/format';
import { getAudioUrl, retryTranscription } from '../../api/activities';
import { qk } from '../../hooks/queries/keys';
import toast from 'react-hot-toast';

const ACTIVITY_ICONS = { CALL: PhoneCall, EMAIL: Mail, MEETING: Calendar, NOTE: FileText, TRANSCRIPT: MessageSquare };

const SECTIONS = [['Action items', 'actionItems'], ['Objections', 'objections'], ['Pricing mentions', 'pricingMentions'], ['Key topics', 'keyTopics']];

/** A call recording's transcript: processing, failed (with Retry) or the structured notes and audio. */
function TranscriptCard({ activity }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [audio, setAudio] = useState(null); // { url } once fetched
  const meta = activity.metadata ?? {};
  const retry = useMutation({
    mutationFn: () => retryTranscription(activity.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.activities.all }),
    onError: (err) => toast.error(err.response?.data?.error || 'Could not retry the transcription'),
  });

  const expand = async () => {
    setOpen((v) => !v);
    if (!open && activity.audioKey && !audio) {
      try {
        setAudio((await getAudioUrl(activity.id)).data);
      } catch {
        setAudio({ error: true });
      }
    }
  };

  if (meta.status === 'processing') {
    return <p className="mt-1 text-xs font-medium text-indigo-600 animate-pulse" aria-live="polite">Transcribing the recording…</p>;
  }
  if (meta.status === 'failed') {
    return (
      <div role="alert" className="mt-1 flex items-center gap-2 flex-wrap text-xs text-red-600">
        {meta.error || 'Transcription failed.'}
        <button type="button" onClick={() => retry.mutate()} disabled={retry.isPending} className="inline-flex items-center gap-1 font-medium text-indigo-600 hover:text-indigo-700">
          <RotateCcw size={11} /> Retry
        </button>
      </div>
    );
  }
  const lists = SECTIONS.filter(([, key]) => Array.isArray(meta[key]) && meta[key].length);
  if (!lists.length && !activity.transcript && !activity.audioKey) return null;
  return (
    <div className="mt-2">
      <button type="button" onClick={expand} aria-expanded={open} className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-700">
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Call details
      </button>
      {open && (
        <div className="mt-2 space-y-2 bg-gray-50 rounded-lg p-3">
          {activity.audioKey && (audio?.url
            ? <audio controls preload="none" src={audio.url} className="w-full h-9"><track kind="captions" /></audio>
            : <p className="text-xs text-gray-400">{audio?.error ? 'The recording could not be loaded.' : 'Loading the recording…'}</p>)}
          {meta.nextSteps && <p className="text-xs text-gray-600"><span className="font-semibold">Next steps:</span> {meta.nextSteps}</p>}
          {lists.map(([title, key]) => (
            <div key={key}>
              <p className="text-xs font-semibold text-gray-600">{title}</p>
              <ul className="list-disc ml-4 text-xs text-gray-600">{meta[key].map((item, i) => <li key={i}>{String(item)}</li>)}</ul>
            </div>
          ))}
          {activity.transcript && (
            <details>
              <summary className="text-xs font-semibold text-gray-600 cursor-pointer">Full transcript</summary>
              <p className="mt-1 text-xs text-gray-500 whitespace-pre-wrap max-h-48 overflow-y-auto">{activity.transcript}</p>
            </details>
          )}
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
              {a.type === 'TRANSCRIPT' && <TranscriptCard activity={a} />}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
