import fs from 'node:fs';
import path from 'node:path';

function getLogPath(baseDir, now = new Date()) {
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const logsDir = path.join(baseDir, 'logs');
  fs.mkdirSync(logsDir, { recursive: true });
  return path.join(logsDir, `events-${yyyy}-${mm}-${dd}.jsonl`);
}

export function logEvent(baseDir, event) {
  const record = {
    ts: new Date().toISOString(),
    ...event
  };
  fs.appendFileSync(getLogPath(baseDir), `${JSON.stringify(record)}\n`);
}
