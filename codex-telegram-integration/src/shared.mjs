export function splitMessage(text, size = 3500) {
  const normalized = String(text ?? '').trim() || '(empty)';
  const chunks = [];
  for (let i = 0; i < normalized.length; i += size) {
    chunks.push(normalized.slice(i, i + size));
  }
  return chunks;
}

export function parseScopedInput(raw, fallbackProject) {
  const value = String(raw ?? '').trim();
  const marker = '::';
  const idx = value.indexOf(marker);
  if (idx === -1) {
    return { projectKey: fallbackProject, payload: value };
  }

  const projectKey = value.slice(0, idx).trim();
  const payload = value.slice(idx + marker.length).trim();
  return { projectKey: projectKey || fallbackProject, payload };
}
