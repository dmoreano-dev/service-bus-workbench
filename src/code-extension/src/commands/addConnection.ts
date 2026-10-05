import * as vscode from 'vscode';
import { randomUUID } from 'crypto';
import { parseServiceBusConnectionString } from '@azure/service-bus';
import { VSCodeCredential } from '../auth/vscodeCredential';
import { listNamespaces, listSubscriptions, listTenants, Subscription } from '../azure/arm';
import { isNameTaken, uniqueName } from '../connections/connectionNames';
import { ConnectionStore } from '../connections/connectionStore';
import { splitByRecent } from '../connections/recentSubscriptions';
import { describeError, isInvalidKey } from '../errors';
import { ClientFactory } from '../serviceBus/clientFactory';
import { ConnectionConfig } from '../types';

type Method = 'connectionString' | 'browse' | 'manual' | 'default' | 'emulator';

const EMULATOR_CONNECTION_STRING =
  'Endpoint=sb://localhost;SharedAccessKeyName=RootManageSharedAccessKey;SharedAccessKey=SAS_KEY_VALUE;UseDevelopmentEmulator=true;';
const EMULATOR_ADMIN_PORT = 5300;
/**
 * Set to false to hide the Microsoft Entra ID options in "Add Connection". Connections that
 * already exist keep working; only adding new ones is turned off.
 */
const ENTRA_ID_ENABLED: boolean = true;
const ENTRA_ID_METHODS: Method[] = ['browse', 'manual', 'default'];
const isEmulator = (connectionString: string) => /UseDevelopmentEmulator\s*=\s*true/i.test(connectionString);

export async function addConnection(store: ConnectionStore, clients: ClientFactory): Promise<void> {
  const methods: (vscode.QuickPickItem & { method: Method })[] = [
    {
      method: 'connectionString',
      label: '$(key) Connection string',
      detail: 'Namespace-level or queue-level shared access (SAS) connection string',
    },
    {
      method: 'browse',
      label: '$(azure) Microsoft Entra ID: browse my subscriptions',
      detail: 'Sign in and pick a namespace from your Azure subscriptions',
    },
    {
      method: 'manual',
      label: '$(globe) Microsoft Entra ID: enter the namespace host name',
      detail: 'Use this when you have data roles on a namespace but cannot see its subscription',
    },
    {
      method: 'default',
      label: '$(terminal) Microsoft Entra ID: Azure CLI or environment credentials',
      detail: 'Uses DefaultAzureCredential: az login, azd, environment variables, managed identity…',
    },
    {
      method: 'emulator',
      label: '$(vm) Local emulator',
      detail: 'Service Bus emulator on localhost with its default ports (5672 and 5300)',
    },
  ];
  const method = await vscode.window.showQuickPick(
    methods.filter((m) => ENTRA_ID_ENABLED || !ENTRA_ID_METHODS.includes(m.method)),
    { title: 'Add Service Bus connection' },
  );
  switch (method?.method) {
    case 'connectionString':
      return addConnectionString(store, clients);
    case 'browse':
      return browseNamespaces(store, clients);
    case 'manual':
      return enterNamespace(store, clients, 'vscode');
    case 'default':
      return enterNamespace(store, clients, 'default');
    case 'emulator': {
      const name = await freeName(store, 'Local emulator');
      if (!name) {
        return;
      }
      return store.add(
        { id: randomUUID(), name, kind: 'connectionString', emulatorAdminPort: EMULATOR_ADMIN_PORT },
        EMULATOR_CONNECTION_STRING,
      );
    }
  }
}

async function addConnectionString(store: ConnectionStore, clients: ClientFactory): Promise<void> {
  const connectionString = await vscode.window.showInputBox({
    title: 'Service Bus connection string',
    prompt: 'Stored in VS Code secret storage, never in settings.',
    placeHolder: 'Endpoint=sb://…;SharedAccessKeyName=…;SharedAccessKey=…',
    password: true,
    ignoreFocusOut: true,
    validateInput: (value) => {
      try {
        parseServiceBusConnectionString(value.trim());
        return undefined;
      } catch (err) {
        return err instanceof Error ? err.message : 'Not a valid Service Bus connection string.';
      }
    },
  });
  if (!connectionString) {
    return;
  }
  const parsed = parseServiceBusConnectionString(connectionString.trim());
  const host = parsed.fullyQualifiedNamespace.split('.')[0];
  const name = await askName(store, parsed.entityPath ? `${host}/${parsed.entityPath}` : host);
  if (!name) {
    return;
  }
  let emulatorAdminPort: number | undefined;
  if (isEmulator(connectionString)) {
    const port = await vscode.window.showInputBox({
      title: 'Emulator management port',
      prompt: `HTTP port of the emulator's management API on ${parsed.fullyQualifiedNamespace.split(':')[0]}, used to list queues and topics.`,
      value: String(EMULATOR_ADMIN_PORT),
      ignoreFocusOut: true,
      validateInput: (value) => (isPort(value) ? undefined : 'Enter a port number between 1 and 65535.'),
    });
    if (!port) {
      return;
    }
    emulatorAdminPort = Number(port);
  }
  await addChecked(
    store,
    clients,
    {
      id: randomUUID(),
      name,
      kind: 'connectionString',
      entityPath: parsed.entityPath,
      emulatorAdminPort,
    },
    parsed.fullyQualifiedNamespace,
    connectionString.trim(),
  );
}

async function browseNamespaces(store: ConnectionStore, clients: ClientFactory): Promise<void> {
  try {
    const subscriptions = await withProgress('Loading Azure subscriptions…', listAllSubscriptions);
    if (subscriptions.length === 0) {
      void vscode.window.showWarningMessage('No Azure subscriptions were found for this account.');
      return;
    }
    const subscription = await vscode.window.showQuickPick(subscriptionItems(subscriptions, store.recentSubscriptions()), {
      title: 'Select a subscription',
    });
    if (!subscription?.subscription) {
      return;
    }
    const { subscriptionId, tenantId } = subscription.subscription;
    await store.rememberSubscription(subscriptionId);
    const namespaces = await withProgress('Loading Service Bus namespaces…', () =>
      listNamespaces(new VSCodeCredential(tenantId), subscriptionId),
    );
    if (namespaces.length === 0) {
      void vscode.window.showWarningMessage('This subscription has no Service Bus namespaces.');
      return;
    }
    const namespace = await vscode.window.showQuickPick(
      namespaces.map((n) => ({ label: n.name, description: n.location, namespace: n })),
      { title: 'Select a namespace' },
    );
    if (!namespace) {
      return;
    }
    const name = await freeName(store, namespace.namespace.name);
    if (!name) {
      return;
    }
    await addChecked(store, clients, {
      id: randomUUID(),
      name,
      kind: 'entra',
      fullyQualifiedNamespace: namespace.namespace.fullyQualifiedNamespace,
      tenantId,
      resourceId: namespace.namespace.id,
    }, namespace.namespace.fullyQualifiedNamespace);
  } catch (err) {
    void vscode.window.showErrorMessage(`Could not browse Azure: ${err instanceof Error ? err.message : String(err)}`);
  }
}

type SubscriptionItem = vscode.QuickPickItem & { subscription?: Subscription };

/** The subscriptions as quick pick items, with the recently used ones in their own group at the top. */
export function subscriptionItems(subscriptions: Subscription[], recentIds: string[]): SubscriptionItem[] {
  const item = (s: Subscription): SubscriptionItem => ({ label: s.displayName, description: s.subscriptionId, subscription: s });
  const { recent, others } = splitByRecent(subscriptions, recentIds);
  if (recent.length === 0) {
    return others.map(item);
  }
  const separator = (label: string): SubscriptionItem => ({ label, kind: vscode.QuickPickItemKind.Separator });
  return [
    separator('Recently used'),
    ...recent.map((s) => ({ ...item(s), iconPath: new vscode.ThemeIcon('history') })),
    ...(others.length > 0 ? [separator('Other subscriptions')] : []),
    ...others.map(item),
  ];
}

/**
 * Subscriptions of every tenant the account belongs to. A token for the default tenant only
 * lists that tenant's subscriptions, and a personal Microsoft account usually has them elsewhere.
 * Other tenants are tried without prompting; sign-in is only requested when nothing was found.
 */
async function listAllSubscriptions(): Promise<Subscription[]> {
  const found = new Map<string, Subscription>();
  const collect = async (tenantId?: string, silent = false) => {
    for (const s of await listSubscriptions(new VSCodeCredential(tenantId, silent))) {
      found.set(s.subscriptionId, s);
    }
  };
  await collect();
  const needSignIn: string[] = [];
  for (const tenantId of await listTenants(new VSCodeCredential())) {
    await collect(tenantId, true).catch(() => needSignIn.push(tenantId));
  }
  for (const tenantId of needSignIn) {
    if (found.size > 0) {
      break;
    }
    await collect(tenantId).catch(() => undefined);
  }
  return [...found.values()];
}

async function enterNamespace(
  store: ConnectionStore,
  clients: ClientFactory,
  credential: 'vscode' | 'default',
): Promise<void> {
  const host = await vscode.window.showInputBox({
    title: 'Namespace host name',
    placeHolder: 'my-namespace.servicebus.windows.net',
    ignoreFocusOut: true,
    validateInput: (value) =>
      /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(value.trim()) ? undefined : 'Enter the host name only, e.g. my-namespace.servicebus.windows.net',
  });
  if (!host) {
    return;
  }
  const tenantId = await vscode.window.showInputBox({
    title: 'Tenant ID (optional)',
    prompt:
      credential === 'default'
        ? 'Leave empty to use the tenant of your Azure CLI or environment credentials.'
        : 'Leave empty to use the default tenant of your signed-in account.',
    ignoreFocusOut: true,
  });
  if (tenantId === undefined) {
    return;
  }
  const fullyQualifiedNamespace = host.trim().toLowerCase();
  const name = await askName(store, fullyQualifiedNamespace.split('.')[0]);
  if (!name) {
    return;
  }
  await addChecked(store, clients, {
    id: randomUUID(),
    name,
    kind: 'entra',
    fullyQualifiedNamespace,
    tenantId: tenantId.trim() || undefined,
    credential,
  }, fullyQualifiedNamespace);
}

/**
 * Saves a connection after checking that it works. A host name or a well-formed connection string
 * proves nothing: without this, a connection with no access, a wrong key or a namespace that does
 * not exist would be saved and only fail when expanded.
 */
async function addChecked(
  store: ConnectionStore,
  clients: ClientFactory,
  connection: ConnectionConfig,
  host: string,
  connectionString?: string,
): Promise<void> {
  // A connection string for a single queue cannot list the namespace, so it is checked by peeking that queue.
  const scopedQueue = connection.kind === 'connectionString' ? connection.entityPath : undefined;
  try {
    await withProgress(`Checking access to ${host}…`, () => clients.probe(connection, connectionString));
  } catch (err) {
    // The native dialog is narrow and cannot be resized: keep the headline short and put the host in the detail.
    const message =
      connection.kind === 'entra'
        ? 'This account could not access the namespace.'
        : 'Could not connect with this connection string.';
    const target = scopedQueue ? `Queue "${scopedQueue}" of ${host}` : host;
    const reason = `${target}\n\n${describeError(err, scopedQueue ? 'peek' : 'list')}`;
    if (isInvalidKey(err)) {
      // Nothing outside the connection string can make it work later, so it is not offered to add it anyway.
      void vscode.window.showErrorMessage(message, { modal: true, detail: reason });
      return;
    }
    const hint =
      connection.kind === 'entra'
        ? 'Add the connection anyway if the role was assigned a moment ago: it can take a few minutes to apply.'
        : scopedQueue
          ? 'Add the connection anyway if its key only has the Send claim.'
          : 'Add the connection anyway if you expect it to work later.';
    const confirm = 'Add Anyway';
    const answer = await vscode.window.showWarningMessage(
      message,
      { modal: true, detail: `${reason}\n\n${hint}` },
      confirm,
    );
    if (answer !== confirm) {
      return;
    }
  }
  await store.add(connection, connectionString);
}

function isPort(value: string): boolean {
  const port = Number(value);
  return /^\d+$/.test(value.trim()) && port >= 1 && port <= 65535;
}

/** Asks for the connection name. Two connections cannot share one: the tree and the history tell them apart by it. */
async function askName(store: ConnectionStore, suggestion: string): Promise<string | undefined> {
  const taken = store.list().map((c) => c.name);
  const name = await vscode.window.showInputBox({
    title: 'Connection name',
    value: uniqueName(taken, suggestion),
    ignoreFocusOut: true,
    validateInput: (value) => {
      if (!value.trim()) {
        return 'Enter a name.';
      }
      return isNameTaken(taken, value) ? `A connection named "${value.trim()}" already exists.` : undefined;
    },
  });
  return name?.trim();
}

/** For the flows that name the connection themselves: asks only when that name is already in use. */
async function freeName(store: ConnectionStore, name: string): Promise<string | undefined> {
  return isNameTaken(store.list().map((c) => c.name), name) ? askName(store, name) : name;
}

function withProgress<T>(title: string, task: () => Promise<T>): Thenable<T> {
  return vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title }, task);
}
