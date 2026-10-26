import { useEffect, useRef, useState } from 'react';
import { Mic, Square, MicOff } from 'lucide-react';
import Button from '../ui/Button';

const MAX_SECONDS = 20 * 60; // keeps a recording under the 25 MB upload limit
const MIME_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
const clock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const supported = () => typeof window !== 'undefined' && typeof window.MediaRecorder !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);

/** Records a call in the browser and hands back a File (webm/opus, or mp4 on Safari). */
export default function CallRecorder({ onRecorded }) {
  const [status, setStatus] = useState(() => (supported() ? 'idle' : 'unsupported')); // idle | requesting | recording | denied | unsupported
  const [elapsed, setElapsed] = useState(0);
  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const timerRef = useRef(null);

  const stop = () => {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
  };

  useEffect(() => () => {
    clearInterval(timerRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
  }, []);

  useEffect(() => {
    if (status === 'recording' && elapsed >= MAX_SECONDS) stop();
  }, [status, elapsed]);

  const start = async () => {
    const mimeType = MIME_TYPES.find((t) => window.MediaRecorder.isTypeSupported(t));
    if (!mimeType) { setStatus('unsupported'); return; }
    setStatus('requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const chunks = [];
      const recorder = new MediaRecorder(stream, { mimeType });
      recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      recorder.onstop = () => {
        clearInterval(timerRef.current);
        stream.getTracks().forEach((t) => t.stop());
        const type = mimeType.split(';')[0];
        onRecorded(new File([new Blob(chunks, { type })], `call-${Date.now()}${type === 'audio/mp4' ? '.m4a' : '.webm'}`, { type }));
        setStatus('idle');
      };
      recorderRef.current = recorder;
      recorder.start(250);
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
      setStatus('recording');
    } catch (err) {
      setStatus(err.name === 'NotAllowedError' ? 'denied' : 'unsupported');
    }
  };

  if (status === 'denied') {
    return <p role="alert" className="flex items-center gap-2 text-xs text-red-600"><MicOff size={14} /> Microphone access denied. Enable it in your browser settings to record.</p>;
  }
  if (status === 'unsupported') {
    return <p className="text-xs text-gray-500">This browser can't record audio. Upload a recording instead.</p>;
  }
  if (status === 'recording') {
    return (
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-2 text-sm font-medium text-red-600" aria-live="polite">
          <span className="w-2.5 h-2.5 rounded-full bg-red-600 animate-pulse" aria-hidden="true" /> Recording {clock(elapsed)}
        </span>
        <Button type="button" size="sm" variant="secondary" onClick={stop}><Square size={12} className="mr-1" /> Stop</Button>
      </div>
    );
  }
  return (
    <Button type="button" size="sm" variant="secondary" onClick={start} loading={status === 'requesting'}>
      <Mic size={13} className="mr-1" /> {status === 'requesting' ? 'Allow the microphone…' : 'Record now'}
    </Button>
  );
}
