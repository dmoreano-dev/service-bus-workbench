import type { TokenCredential } from '@azure/core-auth';

const ARM_ENDPOINT = 'https://management.azure.com';
const ARM_SCOPE = 'https://management.azure.com/.default';

export interface Subscription {
  subscriptionId: string;
  displayName: string;
  tenantId: string;
}

export interface Namespace {
  name: string;
  fullyQualifiedNamespace: string;
  location: string;
}

interface ArmPage<T> {
  value: T[];
  nextLink?: string;
}

async function getAll<T>(credential: TokenCredential, path: string): Promise<T[]> {
  const token = await credential.getToken(ARM_SCOPE);
  if (!token) {
    throw new Error('Could not get an Azure access token.');
  }
  const items: T[] = [];
  let url: string | undefined = `${ARM_ENDPOINT}${path}`;
  while (url) {
    const response: Response = await fetch(url, { headers: { Authorization: `Bearer ${token.token}` } });
    if (!response.ok) {
      throw new Error(`Azure Resource Manager returned ${response.status}: ${await response.text()}`);
    }
    const page = (await response.json()) as ArmPage<T>;
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
  const raw = await getAll<{ name: string; location: string; properties: { serviceBusEndpoint: string } }>(
    credential,
    `/subscriptions/${subscriptionId}/providers/Microsoft.ServiceBus/namespaces?api-version=2021-11-01`,
  );
  return raw.map((n) => ({
    name: n.name,
    location: n.location,
    fullyQualifiedNamespace: new URL(n.properties.serviceBusEndpoint).hostname,
  }));
}
