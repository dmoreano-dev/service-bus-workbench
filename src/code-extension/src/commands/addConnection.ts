import * as vscode from 'vscode';
import { randomUUID } from 'crypto';
import { parseServiceBusConnectionString } from '@azure/service-bus';
import { VSCodeCredential } from '../auth/vscodeCredential';
import { listNamespaces, listSubscriptions, listTenants, Subscription } from '../azure/arm';
import { ConnectionStore } from '../connections/connectionStore';

type Method = 'connectionString' | 'browse' | 'manual' | 'emulator';

const EMULATOR_CONNECTION_STRING =
  'Endpoint=sb://localhost;SharedAccessKeyName=RootManageSharedAccessKey;SharedAccessKey=SAS_KEY_VALUE;UseDevelopmentEmulator=true;';
const EMULATOR_ADMIN_PORT = 5300;
/**
 * Set to false to hide the Microsoft Entra ID options in "Add Connection". Connections that
 * already exist keep working; only adding new ones is turned off.
 */
const ENTRA_ID_ENABLED: boolean = true;
const ENTRA_ID_METHODS: Method[] = ['browse', 'manual'];
const isEmulator = (connectionString: string) => /UseDevelopmentEmulator\s*=\s*true/i.test(connectionString);

export async function addConnection(store: ConnectionStore): Promise<void> {
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
      return addConnectionString(store);
    case 'browse':
      return browseNamespaces(store);
    case 'manual':
      return enterNamespace(store);
    case 'emulator':
      return store.add(
        { id: randomUUID(), name: 'Local emulator', kind: 'connectionString', emulatorAdminPort: EMULATOR_ADMIN_PORT },
        EMULATOR_CONNECTION_STRING,
      );
  }
}

async function addConnectionString(store: ConnectionStore): Promise<void> {
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
  const name = await askName(parsed.entityPath ? `${host}/${parsed.entityPath}` : host);
  if (!name) {
    return;
  }
  await store.add(
    {
      id: randomUUID(),
      name,
      kind: 'connectionString',
      entityPath: parsed.entityPath,
      emulatorAdminPort: isEmulator(connectionString) ? EMULATOR_ADMIN_PORT : undefined,
    },
    connectionString.trim(),
  );
}

async function browseNamespaces(store: ConnectionStore): Promise<void> {
  try {
    const subscriptions = await withProgress('Loading Azure subscriptions…', listAllSubscriptions);
    if (subscriptions.length === 0) {
      void vscode.window.showWarningMessage('No Azure subscriptions were found for this account.');
      return;
    }
    const subscription = await vscode.window.showQuickPick(
      subscriptions.map((s) => ({ label: s.displayName, description: s.subscriptionId, subscription: s })),
      { title: 'Select a subscription' },
    );
    if (!subscription) {
      return;
    }
    const { subscriptionId, tenantId } = subscription.subscription;
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
    await store.add({
      id: randomUUID(),
      name: namespace.namespace.name,
      kind: 'entra',
      fullyQualifiedNamespace: namespace.namespace.fullyQualifiedNamespace,
      tenantId,
    });
  } catch (err) {
    void vscode.window.showErrorMessage(`Could not browse Azure: ${err instanceof Error ? err.message : String(err)}`);
  }
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

async function enterNamespace(store: ConnectionStore): Promise<void> {
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
    prompt: 'Leave empty to use the default tenant of your signed-in account.',
    ignoreFocusOut: true,
  });
  if (tenantId === undefined) {
    return;
  }
  const fullyQualifiedNamespace = host.trim().toLowerCase();
  const name = await askName(fullyQualifiedNamespace.split('.')[0]);
  if (!name) {
    return;
  }
  await store.add({
    id: randomUUID(),
    name,
    kind: 'entra',
    fullyQualifiedNamespace,
    tenantId: tenantId.trim() || undefined,
  });
}

function askName(suggestion: string): Thenable<string | undefined> {
  return vscode.window.showInputBox({
    title: 'Connection name',
    value: suggestion,
    ignoreFocusOut: true,
    validateInput: (value) => (value.trim() ? undefined : 'Enter a name.'),
  });
}

function withProgress<T>(title: string, task: () => Promise<T>): Thenable<T> {
  return vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title }, task);
}
