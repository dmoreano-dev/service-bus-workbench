import * as vscode from 'vscode';
import {
  parseServiceBusConnectionString,
  ServiceBusAdministrationClient,
  ServiceBusClient,
  ServiceBusClientOptions,
} from '@azure/service-bus';
import WebSocket from 'ws';
import { VSCodeCredential } from '../auth/vscodeCredential';
import { ConnectionStore } from '../connections/connectionStore';
import { ConnectionConfig } from '../types';
import { emulatorAdmin, QueueAdmin, sdkAdmin } from './admin';

export interface Clients {
  client: ServiceBusClient;
  admin: QueueAdmin;
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

  private async create(connection: ConnectionConfig): Promise<Clients> {
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
      const connectionString = await this.store.getConnectionString(connection.id);
      if (!connectionString) {
        throw new Error(`The connection string for "${connection.name}" is missing. Remove the connection and add it again.`);
      }
      const client = new ServiceBusClient(connectionString, options);
      if (connection.emulatorAdminPort !== undefined) {
        const host = parseServiceBusConnectionString(connectionString).fullyQualifiedNamespace;
        return { client, admin: emulatorAdmin(`http://${host}:${connection.emulatorAdminPort}`, client) };
      }
      return { client, admin: sdkAdmin(new ServiceBusAdministrationClient(connectionString)) };
    }
    const credential = new VSCodeCredential(connection.tenantId);
    return {
      client: new ServiceBusClient(connection.fullyQualifiedNamespace, credential, options),
      admin: sdkAdmin(new ServiceBusAdministrationClient(connection.fullyQualifiedNamespace, credential)),
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
