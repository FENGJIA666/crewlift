export async function request(path, body) {
  const response = await fetch(path, body === undefined ? {} : {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)
  });
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) {
    const error = new Error(payload?.error?.message || `Please try again. The workspace returned ${response.status}.`);
    error.code = payload?.error?.code;
    throw error;
  }
  return payload;
}

export async function downloadPlan(runId, planId, format) {
  const response = await fetch('/api/export', {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({runId, planId, format})
  });
  if (!response.ok) {
    const payload = await response.json();
    throw new Error(payload?.error?.message || 'Your export is being prepared. Please try again.');
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  const disposition = response.headers.get('content-disposition') || '';
  const filename = disposition.match(/filename="?([^";]+)"?/);
  anchor.download = filename?.[1] || `crewlift-${planId}.${format === 'brief' ? 'md' : format}`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
