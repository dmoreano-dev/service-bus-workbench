import { HistoryEntry } from '../types';

/** True when every word of `query` appears somewhere in the entry (case-insensitive). An empty query matches everything. */
export function matchesQuery(entry: HistoryEntry, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return true;
  }
  const { message } = entry;
  const haystack = [
    entry.queue,
    entry.connectionName,
    entry.origin,
    entry.error,
    message.subject,
    message.messageId,
    message.correlationId,
    message.sessionId,
    message.contentType,
    message.body,
    message.applicationProperties ? JSON.stringify(message.applicationProperties) : undefined,
  ]
    .filter((text): text is string => !!text)
    .join('\n')
    .toLowerCase();
  return words.every((word) => haystack.includes(word));
}

export interface HistoryGroup {
  label: string;
  entries: HistoryEntry[];
}

/** Groups entries by the label `labelOf` gives them, keeping the order in which each label first appears. */
export function groupEntries(entries: HistoryEntry[], labelOf: (entry: HistoryEntry) => string): HistoryGroup[] {
  const groups = new Map<string, HistoryEntry[]>();
  for (const entry of entries) {
    const label = labelOf(entry);
    const group = groups.get(label);
    if (group) {
      group.push(entry);
    } else {
      groups.set(label, [entry]);
    }
  }
  return [...groups].map(([label, group]) => ({ label, entries: group }));
}
