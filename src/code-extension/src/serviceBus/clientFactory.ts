import * as vscode from 'vscode';
import {
  parseServiceBusConnectionString,
  ServiceBusAdministrationClient,
  ServiceBusClient,
  ServiceBusClientOptions,
} from '@azure/service-bus';
import { DefaultAzureCredential } from '@azure/identity';
import WebSocket from 'ws';
import { VSCodeCredential } from '../auth/vscodeCredential';
import { ConnectionStore } from '../connections/connectionStore';
import { ConnectionConfig } from '../types';
import { peek } from './operations';
import { armAdmin, emulatorAdmin, EntityAdmin, sdkAdmin, withFallback } from './admin';

export interface Clients {
  client: ServiceBusClient;
  admin: EntityAdmin;
}

/** Creates and caches one pair of SDK clients per connection. */
export class ClientFactory {
  private readonly cache = new Map<string, Clients>();

  constructor(private readonly store: ConnectionStore) {}

  async get(connection: ConnectionConfig): Promise<Clients> {
    const cached = this.cache.get(connection.id);
    if (cached) {
      return cached;
    }
    const clients = await this.create(connection);
    this.cache.set(connection.id, clients);
    return clients;
  }

  /**
   * Checks a connection before it is saved, with clients that are not cached: lists the queues, or
   * peeks one message when the connection string is scoped to a single queue. Throws what that throws.
   * `connectionString` is needed for a connection string that is not in the store yet.
   */
  async probe(connection: ConnectionConfig, connectionString?: string): Promise<void> {
    const { client, admin } = await this.create(connection, connectionString);
    try {
      if (connection.kind === 'connectionString' && connection.entityPath) {
        await peek(client, { queue: connection.entityPath }, 'active', 1);
      } else {
        await admin.listQueues();
      }
    } finally {
      await client.close().catch(() => undefined);
    }
  }

  private async create(connection: ConnectionConfig, unsavedConnectionString?: string): Promise<Clients> {
    // The SDK defaults (3 retries, 30 s apart) suit background services. It also retries
    // authorization failures, so a missing role would leave a panel waiting for 90 seconds.
    const options: ServiceBusClientOptions = {
      retryOptions: { maxRetries: 1, retryDelayInMs: 1000, timeoutInMs: 30_000 },
    };
    const isEmulator = connection.kind === 'connectionString' && connection.emulatorAdminPort !== undefined;
    // The emulator only supports AMQP over TCP.
    if (!isEmulator && vscode.workspace.getConfiguration('serviceBusWorkbench').get<boolean>('useWebSockets')) {
      options.webSocketOptions = { webSocket: WebSocket };
    }
    if (connection.kind === 'connectionString') {
      const connectionString = unsavedConnectionString ?? (await this.store.getConnectionString(connection.id));
      if (!connectionString) {
        throw new Error(`The connection string for "${connection.name}" is missing. Remove the connection and add it again.`);
      }
      const client = new ServiceBusClient(connectionString, options);
      if (connection.emulatorAdminPort !== undefined) {
        // The endpoint may carry the AMQP port (sb://host:5673); the management API has its own.
        const host = parseServiceBusConnectionString(connectionString).fullyQualifiedNamespace.split(':')[0];
        return { client, admin: emulatorAdmin(`http://${host}:${connection.emulatorAdminPort}`, client) };
      }
      return { client, admin: sdkAdmin(new ServiceBusAdministrationClient(connectionString)) };
    }
    const credential =
      connection.credential === 'default'
        ? new DefaultAzureCredential(connection.tenantId ? { tenantId: connection.tenantId } : {})
        : new VSCodeCredential(connection.tenantId);
    const dataPlane = sdkAdmin(new ServiceBusAdministrationClient(connection.fullyQualifiedNamespace, credential));
    return {
      client: new ServiceBusClient(connection.fullyQualifiedNamespace, credential, options),
      // The data-plane API needs Data Owner. With only Reader on the namespace, ARM can still list the entities.
      admin: connection.resourceId ? withFallback(dataPlane, armAdmin(credential, connection.resourceId)) : dataPlane,
    };
  }

  /** Closes the clients of one connection, or of all connections when no id is given. */
  async dispose(connectionId?: string): Promise<void> {
    const ids = connectionId ? [connectionId] : [...this.cache.keys()];
    for (const id of ids) {
      const clients = this.cache.get(id);
      this.cache.delete(id);
      await clients?.client.close().catch(() => undefined);
    }
  }
}
