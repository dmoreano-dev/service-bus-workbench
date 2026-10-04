import type { TokenCredential } from '@azure/core-auth';
import { QueueInfo, SubscriptionInfo, TopicInfo } from '../types';

const ARM_ENDPOINT = 'https://management.azure.com';
const ARM_SCOPE = 'https://management.azure.com/.default';

export interface Subscription {
  subscriptionId: string;
  displayName: string;
  tenantId: string;
}

export interface Namespace {
  /** ARM resource id: /subscriptions/…/providers/Microsoft.ServiceBus/namespaces/<name>. */
  id: string;
  name: string;
  fullyQualifiedNamespace: string;
  location: string;
}

interface ArmPage<T> {
  value: T[];
  nextLink?: string;
}

async function getJson<T>(credential: TokenCredential, url: string): Promise<T> {
  const token = await credential.getToken(ARM_SCOPE);
  if (!token) {
    throw new Error('Could not get an Azure access token.');
  }
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token.token}` } });
  if (!response.ok) {
    throw new Error(`Azure Resource Manager returned ${response.status}: ${await response.text()}`);
  }
  return (await response.json()) as T;
}

async function getAll<T>(credential: TokenCredential, path: string): Promise<T[]> {
  const items: T[] = [];
  let url: string | undefined = `${ARM_ENDPOINT}${path}`;
  while (url) {
    const page: ArmPage<T> = await getJson<ArmPage<T>>(credential, url);
    items.push(...page.value);
    url = page.nextLink;
  }
  return items;
}

/** Tenants (directories) the account belongs to. A token only sees the subscriptions of its own tenant. */
export async function listTenants(credential: TokenCredential): Promise<string[]> {
  const tenants = await getAll<{ tenantId: string }>(credential, '/tenants?api-version=2022-12-01');
  return tenants.map((t) => t.tenantId);
}

export function listSubscriptions(credential: TokenCredential): Promise<Subscription[]> {
  return getAll<Subscription>(credential, '/subscriptions?api-version=2022-12-01');
}

export async function listNamespaces(credential: TokenCredential, subscriptionId: string): Promise<Namespace[]> {
  const raw = await getAll<{ id: string; name: string; location: string; properties: { serviceBusEndpoint: string } }>(
    credential,
    `/subscriptions/${subscriptionId}/providers/Microsoft.ServiceBus/namespaces?api-version=2021-11-01`,
  );
  return raw.map((n) => ({
    id: n.id,
    name: n.name,
    location: n.location,
    fullyQualifiedNamespace: new URL(n.properties.serviceBusEndpoint).hostname,
  }));
}

const ENTITY_API = 'api-version=2021-11-01';

interface ArmCounts {
  activeMessageCount?: number;
  deadLetterMessageCount?: number;
  scheduledMessageCount?: number;
}

interface ArmEntity<P> {
  name: string;
  properties?: P;
}

const queueInfo = (q: ArmEntity<{ countDetails?: ArmCounts }>): QueueInfo => ({
  name: q.name,
  activeMessageCount: q.properties?.countDetails?.activeMessageCount,
  deadLetterMessageCount: q.properties?.countDetails?.deadLetterMessageCount,
  scheduledMessageCount: q.properties?.countDetails?.scheduledMessageCount,
});

/**
 * The entities of a namespace read through Azure Resource Manager. It needs only the Reader role,
 * so it works for accounts that have no Service Bus data role or Manage claim.
 */
export async function listArmQueues(credential: TokenCredential, namespaceId: string): Promise<QueueInfo[]> {
  const queues = await getAll<ArmEntity<{ countDetails?: ArmCounts }>>(credential, `${namespaceId}/queues?${ENTITY_API}`);
  return queues.map(queueInfo);
}

export async function getArmQueue(credential: TokenCredential, namespaceId: string, name: string): Promise<QueueInfo> {
  const url = `${ARM_ENDPOINT}${namespaceId}/queues/${encodeURIComponent(name)}?${ENTITY_API}`;
  return queueInfo(await getJson<ArmEntity<{ countDetails?: ArmCounts }>>(credential, url));
}

export async function listArmTopics(credential: TokenCredential, namespaceId: string): Promise<TopicInfo[]> {
  const topics = await getAll<ArmEntity<{ subscriptionCount?: number }>>(credential, `${namespaceId}/topics?${ENTITY_API}`);
  return topics.map((t) => ({ name: t.name, subscriptionCount: t.properties?.subscriptionCount }));
}

export async function listArmSubscriptions(
  credential: TokenCredential,
  namespaceId: string,
  topic: string,
): Promise<SubscriptionInfo[]> {
  const subscriptions = await getAll<ArmEntity<{ countDetails?: ArmCounts }>>(
    credential,
    `${namespaceId}/topics/${encodeURIComponent(topic)}/subscriptions?${ENTITY_API}`,
  );
  return subscriptions.map((s) => ({
    topic,
    name: s.name,
    activeMessageCount: s.properties?.countDetails?.activeMessageCount,
    deadLetterMessageCount: s.properties?.countDetails?.deadLetterMessageCount,
  }));
}
