import { ServiceBusAdministrationClient, ServiceBusClient } from '@azure/service-bus';
import { QueueInfo } from '../types';
import { peek } from './operations';

/** The queue metadata the tree needs. Azure and the local emulator provide it in different ways. */
export interface QueueAdmin {
  listQueues(): Promise<QueueInfo[]>;
  getQueue(name: string): Promise<QueueInfo>;
}

const byName = (a: QueueInfo, b: QueueInfo) => a.name.localeCompare(b.name);

export function sdkAdmin(admin: ServiceBusAdministrationClient): QueueAdmin {
  return {
    async listQueues() {
      const queues: QueueInfo[] = [];
      for await (const q of admin.listQueuesRuntimeProperties()) {
        queues.push({
          name: q.name,
          activeMessageCount: q.activeMessageCount,
          deadLetterMessageCount: q.deadLetterMessageCount,
          scheduledMessageCount: q.scheduledMessageCount,
        });
      }
      return queues.sort(byName);
    },
    async getQueue(name) {
      const q = await admin.getQueueRuntimeProperties(name);
      return {
        name: q.name,
        activeMessageCount: q.activeMessageCount,
        deadLetterMessageCount: q.deadLetterMessageCount,
        scheduledMessageCount: q.scheduledMessageCount,
      };
    },
  };
}

/** Counts above this are shown as "100+" for the emulator. */
const EMULATOR_COUNT_CAP = 100;

/**
 * The JS administration client only speaks HTTPS, and the emulator (2.0+) serves its management
 * API over plain HTTP, so queue names are read with fetch. The emulator always reports a message
 * count of 0, so counts come from peeking instead.
 */
export function emulatorAdmin(baseUrl: string, client: ServiceBusClient): QueueAdmin {
  const withCounts = async (name: string): Promise<QueueInfo> => {
    const [active, deadLetter] = await Promise.all([
      peek(client, name, 'active', EMULATOR_COUNT_CAP),
      peek(client, name, 'deadLetter', EMULATOR_COUNT_CAP),
    ]);
    return {
      name,
      activeMessageCount: active.length,
      deadLetterMessageCount: deadLetter.length,
      countCap: EMULATOR_COUNT_CAP,
    };
  };
  return {
    async listQueues() {
      const url = `${baseUrl}/$Resources/queues?api-version=2021-05&$skip=0&$top=100`;
      let response: Response;
      try {
        response = await fetch(url);
      } catch {
        throw new Error(`Cannot reach the emulator management API at ${baseUrl}. Is the emulator running?`);
      }
      if (response.status === 404) {
        throw new Error('This emulator has no management API. Listing queues needs Service Bus emulator 2.0 or later.');
      }
      if (!response.ok) {
        throw new Error(`The emulator management API returned ${response.status}.`);
      }
      const names = parseEntryTitles(await response.text());
      return (await Promise.all(names.map(withCounts))).sort(byName);
    },
    getQueue: withCounts,
  };
}

/** Extracts the title of every <entry> in an ATOM feed, skipping the feed's own title. */
export function parseEntryTitles(feed: string): string[] {
  return feed
    .split('<entry')
    .slice(1)
    .map((entry) => /<title[^>]*>([^<]*)<\/title>/.exec(entry)?.[1])
    .filter((title): title is string => !!title)
    .map(unescapeXml);
}

function unescapeXml(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}
