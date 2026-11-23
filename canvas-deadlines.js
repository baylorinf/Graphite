'use strict';
// Assignment due dates that Canvas moved between two complete syncs of the same account. The first complete sync
// only records a baseline; each later one compares against it. One record per assignment: a date that moves again
// updates that record (keeping the first known date as "from"), and a date that moves back to it removes the record.
const SITE = 'https://oc.sjtu.edu.cn';
const MAX = 50;

// Only an account identifier can associate two personal deadline histories.
function ownerOf(state) {
  if (!state) return '';
  const id = state.portalSyncEnabled ? state.snapshot?.webIdentity : state.accountId || state.auth?.userId;
  if (id != null && String(id).trim()) return (state.portalSyncEnabled ? 'web:' : 'api:') + String(id).trim();
  return '';
}

function sourceUrl(courseId, assignmentId) {
  return SITE + '/courses/' + encodeURIComponent(courseId) + '/assignments/' + encodeURIComponent(assignmentId);
}

function track(previous, next, now = new Date(), complete = !!next?.snapshot?.courses && !!next.syncedAt && next.syncedAt !== previous?.syncedAt) {
  if (!next) return next;
  const owner = ownerOf(next);
  let record = next.deadlines && next.deadlines.owner === owner && owner ? next.deadlines : null;
  if (complete && owner) {
    const base = { ...(record?.base || {}) };
    const changes = new Map((record?.changes || []).map(c => [c.courseId + ':' + c.assignmentId, c]));
    const seenAt = now.toISOString();
    for (const course of next.snapshot.courses) {
      for (const item of course.assignments || []) {
        if (item?.id == null || !item.dueAt || Number.isNaN(Date.parse(item.dueAt))) continue;
        const key = course.id + ':' + item.id, before = base[key];
        base[key] = item.dueAt;
        if (!record || !before || Date.parse(before) === Date.parse(item.dueAt)) continue;
        const from = changes.get(key)?.from || before;
        if (Date.parse(from) === Date.parse(item.dueAt)) { changes.delete(key); continue; }
        changes.set(key, { courseId: String(course.id), assignmentId: String(item.id), courseName: String(course.name || ''),
          title: String(item.title || ''), seenAt, from, to: item.dueAt,
          kind: Date.parse(item.dueAt) < Date.parse(from) ? 'earlier' : 'later', url: sourceUrl(course.id, item.id) });
      }
    }
    record = { owner, base, changes: [...changes.values()].sort((a, b) => Date.parse(b.seenAt) - Date.parse(a.seenAt)).slice(0, MAX) };
  }
  if (record === next.deadlines) return next;
  const out = { ...next };
  if (record) out.deadlines = record; else delete out.deadlines;
  return out;
}

// The list the status endpoint returns: only the current account's records.
function changesFor(state) {
  const owner = ownerOf(state);
  if (!owner || state?.deadlines?.owner !== owner) return [];
  return (state.deadlines.changes || []).map(c => ({...c,url:sourceUrl(c.courseId,c.assignmentId)}));
}

module.exports = { track, changesFor, ownerOf };
