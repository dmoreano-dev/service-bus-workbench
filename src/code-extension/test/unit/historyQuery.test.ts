import { describe, expect, it } from 'vitest';
import { groupEntries, matchesQuery } from '../../src/history/historyQuery';
import { HistoryEntry } from '../../src/types';

const entry = (overrides: Partial<HistoryEntry> = {}): HistoryEntry => ({
  id: '1',
  timestamp: '2026-10-03T10:00:00.000Z',
  kind: 'send',
  connectionId: 'c1',
  connectionName: 'Local emulator',
  queue: 'orders',
  status: 'ok',
  message: { body: '{"orderId":1001}', subject: 'OrderCreated', applicationProperties: { tenant: 'acme' } },
  ...overrides,
});

describe('matchesQuery', () => {
  it('matches everything when the query is empty', () => {
    expect(matchesQuery(entry(), '')).toBe(true);
    expect(matchesQuery(entry(), '   ')).toBe(true);
  });

  it('looks in the destination, the connection, the properties and the body, ignoring case', () => {
    expect(matchesQuery(entry(), 'ORDERS')).toBe(true);
    expect(matchesQuery(entry(), 'emulator')).toBe(true);
    expect(matchesQuery(entry(), 'ordercreated')).toBe(true);
    expect(matchesQuery(entry(), 'acme')).toBe(true);
    expect(matchesQuery(entry(), '1001')).toBe(true);
  });

  it('requires every word', () => {
    expect(matchesQuery(entry(), 'orders acme')).toBe(true);
    expect(matchesQuery(entry(), 'orders globex')).toBe(false);
  });

  it('finds failed sends by their error', () => {
    expect(matchesQuery(entry({ status: 'error', error: 'Not authorized to send' }), 'authorized')).toBe(true);
  });
});

describe('groupEntries', () => {
  it('groups by label in order of first appearance', () => {
    const entries = [entry({ id: '1' }), entry({ id: '2', queue: 'payments' }), entry({ id: '3' })];
    const groups = groupEntries(entries, (e) => e.queue);
    expect(groups.map((g) => g.label)).toEqual(['orders', 'payments']);
    expect(groups[0].entries.map((e) => e.id)).toEqual(['1', '3']);
  });

  it('returns no groups for no entries', () => {
    expect(groupEntries([], (e) => e.queue)).toEqual([]);
  });
});
