import { describe, expect, it } from 'vitest';
import { pushRecent, splitByRecent } from '../../src/connections/recentSubscriptions';

describe('pushRecent', () => {
  it('puts the subscription first', () => {
    expect(pushRecent(['a', 'b'], 'c')).toEqual(['c', 'a', 'b']);
  });

  it('moves a subscription that was already there instead of repeating it', () => {
    expect(pushRecent(['a', 'b', 'c'], 'c')).toEqual(['c', 'a', 'b']);
  });

  it('drops the oldest ones beyond the limit', () => {
    expect(pushRecent(['a', 'b', 'c'], 'd', 3)).toEqual(['d', 'a', 'b']);
  });
});

describe('splitByRecent', () => {
  const subscriptions = ['a', 'b', 'c', 'd'].map((subscriptionId) => ({ subscriptionId }));
  const ids = (list: { subscriptionId: string }[]) => list.map((s) => s.subscriptionId);

  it('lists the recent ones most recent first and leaves the rest in their order', () => {
    const { recent, others } = splitByRecent(subscriptions, ['c', 'a']);
    expect(ids(recent)).toEqual(['c', 'a']);
    expect(ids(others)).toEqual(['b', 'd']);
  });

  it('ignores recent subscriptions the account no longer sees', () => {
    const { recent, others } = splitByRecent(subscriptions, ['gone', 'b']);
    expect(ids(recent)).toEqual(['b']);
    expect(ids(others)).toEqual(['a', 'c', 'd']);
  });

  it('has no recent ones when nothing was used yet', () => {
    const { recent, others } = splitByRecent(subscriptions, []);
    expect(recent).toEqual([]);
    expect(ids(others)).toEqual(['a', 'b', 'c', 'd']);
  });
});
