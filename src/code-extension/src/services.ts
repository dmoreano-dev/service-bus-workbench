import { ConnectionStore } from './connections/connectionStore';
import { describeError } from './errors';
import { HistoryStore } from './history/historyStore';
import { ClientFactory } from './serviceBus/clientFactory';
import { send } from './serviceBus/operations';
import { ConnectionConfig, HistoryKind, OutgoingMessage } from './types';

/** Shared dependencies handed to views and panels. */
export interface Services {
  connections: ConnectionStore;
  clients: ClientFactory;
  history: HistoryStore;
  /** Reloads queue counts in the connections tree. */
  refreshTree(): void;
}

export interface SendRequest {
  connection: ConnectionConfig;
  queue: string;
  message: OutgoingMessage;
  kind: HistoryKind;
  origin?: string;
}

/** Sends a message and records the attempt, successful or not, in the history. Throws a user-facing error on failure. */
export async function sendAndRecord(services: Services, request: SendRequest): Promise<void> {
  const { connection, queue, message, kind, origin } = request;
  const base = { kind, origin, connectionId: connection.id, connectionName: connection.name, queue, message };
  try {
    const { client } = await services.clients.get(connection);
    await send(client, queue, message);
  } catch (err) {
    const error = describeError(err, 'send');
    await services.history.add({ ...base, status: 'error', error });
    throw new Error(error);
  }
  await services.history.add({ ...base, status: 'ok' });
  services.refreshTree();
}
