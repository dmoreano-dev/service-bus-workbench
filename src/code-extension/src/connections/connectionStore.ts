import * as vscode from 'vscode';
import { ConnectionConfig, ConnectionProtection } from '../types';

const CONNECTIONS_KEY = 'sbw.connections';
const secretKey = (id: string) => `sbw.connectionString.${id}`;

/** Connection metadata lives in globalState; connection strings live in SecretStorage. */
export class ConnectionStore {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;

  constructor(private readonly context: vscode.ExtensionContext) {}

  list(): ConnectionConfig[] {
    return this.context.globalState.get<ConnectionConfig[]>(CONNECTIONS_KEY, []);
  }

  get(id: string): ConnectionConfig | undefined {
    return this.list().find((c) => c.id === id);
  }

  async add(config: ConnectionConfig, connectionString?: string): Promise<void> {
    if (connectionString) {
      await this.context.secrets.store(secretKey(config.id), connectionString);
    }
    await this.context.globalState.update(CONNECTIONS_KEY, [...this.list(), config]);
    this.emitter.fire();
  }

  async update(id: string, protection: ConnectionProtection): Promise<void> {
    await this.context.globalState.update(
      CONNECTIONS_KEY,
      this.list().map((c) => (c.id === id ? { ...c, ...protection } : c)),
    );
    this.emitter.fire();
  }

  async remove(id: string): Promise<void> {
    await this.context.secrets.delete(secretKey(id));
    await this.context.globalState.update(
      CONNECTIONS_KEY,
      this.list().filter((c) => c.id !== id),
    );
    this.emitter.fire();
  }

  getConnectionString(id: string): Thenable<string | undefined> {
    return this.context.secrets.get(secretKey(id));
  }
}
