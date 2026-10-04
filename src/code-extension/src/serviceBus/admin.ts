import type { TokenCredential } from '@azure/core-auth';
import { ServiceBusAdministrationClient, ServiceBusClient } from '@azure/service-bus';
import { getArmQueue, listArmQueues, listArmSubscriptions, listArmTopics } from '../azure/arm';
import { isUnauthorized } from '../errors';
import { MessageSource, QueueInfo, SubscriptionInfo, TopicInfo } from '../types';
import { peek } from './operations';

/** The entity metadata the tree needs. Azure and the local emulator provide it in different ways. */
export interface EntityAdmin {
  listQueues(): Promise<QueueInfo[]>;
  getQueue(name: string): Promise<QueueInfo>;
  listTopics(): Promise<TopicInfo[]>;
  listSubscriptions(topic: string): Promise<SubscriptionInfo[]>;
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

export function sdkAdmin(admin: ServiceBusAdministrationClient): EntityAdmin {
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
    async listTopics() {
      const topics: TopicInfo[] = [];
      for await (const t of admin.listTopicsRuntimeProperties()) {
        topics.push({ name: t.name, subscriptionCount: t.subscriptionCount });
      }
      return topics.sort(byName);
    },
    async listSubscriptions(topic) {
      const subscriptions: SubscriptionInfo[] = [];
      for await (const s of admin.listSubscriptionsRuntimeProperties(topic)) {
        subscriptions.push({
          topic,
          name: s.subscriptionName,
          activeMessageCount: s.activeMessageCount,
          deadLetterMessageCount: s.deadLetterMessageCount,
        });
      }
      return subscriptions.sort(byName);
    },
  };
}

/** Reads the entities through Azure Resource Manager, which only needs the Reader role on the namespace. */
export function armAdmin(credential: TokenCredential, namespaceId: string): EntityAdmin {
  return {
    listQueues: async () => (await listArmQueues(credential, namespaceId)).sort(byName),
    getQueue: (name) => getArmQueue(credential, namespaceId, name),
    listTopics: async () => (await listArmTopics(credential, namespaceId)).sort(byName),
    listSubscriptions: async (topic) => (await listArmSubscriptions(credential, namespaceId, topic)).sort(byName),
  };
}

/**
 * Uses `primary`, and switches to `fallback` for good the first time `primary` is refused for lack
 * of permissions. If the fallback fails too, the original error is the one reported.
 */
export function withFallback(primary: EntityAdmin, fallback: EntityAdmin): EntityAdmin {
  let useFallback = false;
  const call = async <T>(action: (admin: EntityAdmin) => Promise<T>): Promise<T> => {
    if (useFallback) {
      return action(fallback);
    }
    try {
      return await action(primary);
    } catch (err) {
      if (!isUnauthorized(err)) {
        throw err;
      }
      let result: T;
      try {
        result = await action(fallback);
      } catch {
        throw err;
      }
      useFallback = true;
      return result;
    }
  };
  return {
    listQueues: () => call((a) => a.listQueues()),
    getQueue: (name) => call((a) => a.getQueue(name)),
    listTopics: () => call((a) => a.listTopics()),
    listSubscriptions: (topic) => call((a) => a.listSubscriptions(topic)),
  };
}

/** Counts above this are shown as "100+" for the emulator. */
const EMULATOR_COUNT_CAP = 100;

/**
 * The emulator does not check the signature, but it answers 500 when listing subscriptions
 * unless the request carries a SAS token that has not expired.
 */
const EMULATOR_AUTHORIZATION = 'SharedAccessSignature sr=emulator&sig=emulator&se=9999999999&skn=RootManageSharedAccessKey';

/**
 * The JS administration client only speaks HTTPS, and the emulator (2.0+) serves its management
 * API over plain HTTP, so entity names are read with fetch. The emulator always reports a message
 * count of 0, so counts come from peeking instead.
 */
export function emulatorAdmin(baseUrl: string, client: ServiceBusClient): EntityAdmin {
  const counts = async (source: MessageSource) => {
    const [active, deadLetter] = await Promise.all([
      peek(client, source, 'active', EMULATOR_COUNT_CAP),
      peek(client, source, 'deadLetter', EMULATOR_COUNT_CAP),
    ]);
    return {
      activeMessageCount: active.length,
      deadLetterMessageCount: deadLetter.length,
      countCap: EMULATOR_COUNT_CAP,
    };
  };
  const queueWithCounts = async (name: string): Promise<QueueInfo> => ({ name, ...(await counts({ queue: name })) });
  /** Reads the entity names of one ATOM feed of the management API. */
  const listNames = async (path: string): Promise<string[]> => {
    const url = `${baseUrl}/${path}?api-version=2021-05&$skip=0&$top=100`;
    let response: Response;
    try {
      response = await fetch(url, { headers: { Authorization: EMULATOR_AUTHORIZATION } });
    } catch {
      throw new Error(`Cannot reach the emulator management API at ${baseUrl}. Is the emulator running?`);
    }
    if (response.status === 404) {
      throw new Error('This emulator has no management API. Listing entities needs Service Bus emulator 2.0 or later.');
    }
    if (!response.ok) {
      throw new Error(`The emulator management API returned ${response.status}.`);
    }
    return parseEntryTitles(await response.text());
  };
  return {
    async listQueues() {
      const names = await listNames('$Resources/queues');
      return (await Promise.all(names.map(queueWithCounts))).sort(byName);
    },
    getQueue: queueWithCounts,
    async listTopics() {
      const names = await listNames('$Resources/topics');
      return names.map((name) => ({ name })).sort(byName);
    },
    async listSubscriptions(topic) {
      const names = await listNames(`${encodeURIComponent(topic)}/subscriptions`);
      const subscriptions = await Promise.all(
        names.map(async (name) => ({ topic, name, ...(await counts({ topic, subscription: name })) })),
      );
      return subscriptions.sort(byName);
    },
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
