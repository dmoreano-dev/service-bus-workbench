import { describe, expect, it, vi } from 'vitest';
import { EntityAdmin, parseEntryTitles, withFallback } from '../../src/serviceBus/admin';

describe('parseEntryTitles', () => {
  it('reads the title of every entry and skips the title of the feed', () => {
    const feed = `<feed xmlns="http://www.w3.org/2005/Atom"><title type="text">Queues</title>
      <entry><id>1</id><title type="text">orders</title></entry>
      <entry><id>2</id><title type="text">payments</title></entry></feed>`;
    expect(parseEntryTitles(feed)).toEqual(['orders', 'payments']);
  });

  it('unescapes XML entities', () => {
    expect(parseEntryTitles('<feed><entry><title>a&amp;b&lt;c</title></entry></feed>')).toEqual(['a&b<c']);
  });

  it('returns nothing for an empty feed', () => {
    expect(parseEntryTitles('<feed><title>Queues</title></feed>')).toEqual([]);
  });
});

describe('withFallback', () => {
  const admin = (listQueues: EntityAdmin['listQueues']): EntityAdmin => ({
    listQueues,
    getQueue: async (name) => ({ name }),
    listTopics: async () => [],
    listSubscriptions: async () => [],
  });
  const unauthorized = Object.assign(new Error('needs Manage'), { statusCode: 401 });

  it('uses the primary while it works', async () => {
    const fallback = vi.fn(async () => [{ name: 'from-arm' }]);
    const result = await withFallback(admin(async () => [{ name: 'orders' }]), admin(fallback)).listQueues();
    expect(result).toEqual([{ name: 'orders' }]);
    expect(fallback).not.toHaveBeenCalled();
  });

  it('switches to the fallback for good once the primary is refused', async () => {
    const primary = vi.fn(async () => {
      throw unauthorized;
    });
    const combined = withFallback(admin(primary), admin(async () => [{ name: 'from-arm' }]));
    expect(await combined.listQueues()).toEqual([{ name: 'from-arm' }]);
    expect(await combined.listQueues()).toEqual([{ name: 'from-arm' }]);
    expect(primary).toHaveBeenCalledTimes(1);
  });

  it('does not fall back for errors that are not about permissions', async () => {
    const fallback = vi.fn(async () => []);
    const combined = withFallback(
      admin(async () => {
        throw Object.assign(new Error('offline'), { code: 'ENOTFOUND' });
      }),
      admin(fallback),
    );
    await expect(combined.listQueues()).rejects.toThrow('offline');
    expect(fallback).not.toHaveBeenCalled();
  });

  it('reports the original error when the fallback fails too', async () => {
    const combined = withFallback(
      admin(async () => {
        throw unauthorized;
      }),
      admin(async () => {
        throw new Error('ARM said no');
      }),
    );
    await expect(combined.listQueues()).rejects.toThrow('needs Manage');
  });
});
