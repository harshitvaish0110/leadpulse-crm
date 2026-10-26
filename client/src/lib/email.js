/**
 * Splits a generated email into subject and body. The model is asked to start
 * with "Subject: …" and a blank line; while streaming, the subject line may not
 * be complete yet, so an unfinished first line stays out of the body.
 */
export function parseEmail(text) {
  const raw = String(text ?? '').replace(/\r\n/g, '\n').replace(/^\s+/, '');
  const match = /^subject:[ \t]*(.*)(\n|$)/i.exec(raw);
  if (!match) return { subject: '', body: raw.trim() };
  const subjectDone = match[2] === '\n';
  return {
    subject: match[1].trim(),
    body: subjectDone ? raw.slice(match[0].length).trim() : '',
  };
}
