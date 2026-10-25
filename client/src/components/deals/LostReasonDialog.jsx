import { useState } from 'react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';

const LOST_REASONS = ['Price too high', 'Chose competitor', 'No budget', 'No decision made', 'Feature gap', 'Poor timing'];

/** Asks why a deal was lost before it moves to a Lost stage. Open while `pending` is set. */
export default function LostReasonDialog({ pending, onCancel, onConfirm }) {
  const [reason, setReason] = useState(LOST_REASONS[0]);
  return (
    <Modal isOpen={Boolean(pending)} onClose={onCancel} title="Why was this deal lost?" size="sm">
      <form onSubmit={(e) => { e.preventDefault(); onConfirm(reason); }} className="space-y-4">
        <fieldset className="space-y-2">
          <legend className="sr-only">Lost reason</legend>
          {LOST_REASONS.map(r => (
            <label key={r} className="flex items-center gap-2 text-sm text-gray-700">
              <input type="radio" name="lost-reason" value={r} checked={reason === r} onChange={() => setReason(r)} /> {r}
            </label>
          ))}
        </fieldset>
        <div className="flex gap-3">
          <Button type="button" variant="secondary" className="flex-1" onClick={onCancel}>Cancel</Button>
          <Button type="submit" className="flex-1">Mark as lost</Button>
        </div>
      </form>
    </Modal>
  );
}
