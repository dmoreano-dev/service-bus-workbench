import * as vscode from 'vscode';
import { describeError } from '../errors';
import { Services } from '../services';
import { ConnectionConfig, QueueInfo, SubQueue } from '../types';

function formatCount(count: number | undefined, queue: QueueInfo): string {
  const value = count ?? 0;
  return queue.countCap !== undefined && value >= queue.countCap ? `${queue.countCap}+` : String(value);
}

export class ConnectionNode extends vscode.TreeItem {
  constructor(readonly connection: ConnectionConfig) {
    super(connection.name, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = 'connection';
    if (connection.kind === 'entra') {
      this.iconPath = new vscode.ThemeIcon('azure');
      this.description = 'Entra ID';
      this.tooltip = connection.fullyQualifiedNamespace;
    } else if (connection.emulatorAdminPort !== undefined) {
      this.iconPath = new vscode.ThemeIcon('vm');
      this.description = 'Emulator';
    } else {
      this.iconPath = new vscode.ThemeIcon('key');
      this.description = 'Connection string';
    }
  }
}

export class QueueNode extends vscode.TreeItem {
  constructor(
    readonly connection: ConnectionConfig,
    readonly queue: QueueInfo,
  ) {
    super(queue.name, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = 'queue';
    this.iconPath = new vscode.ThemeIcon('inbox');
    if (queue.activeMessageCount !== undefined) {
      this.description = `${formatCount(queue.activeMessageCount, queue)} active · ${formatCount(queue.deadLetterMessageCount, queue)} dead-letter`;
    }
  }
}

export class SubQueueNode extends vscode.TreeItem {
  constructor(
    readonly connection: ConnectionConfig,
    readonly queue: QueueInfo,
    readonly subQueue: SubQueue,
  ) {
    super(subQueue === 'active' ? 'Messages' : 'Dead-letter', vscode.TreeItemCollapsibleState.None);
    const count = subQueue === 'active' ? queue.activeMessageCount : queue.deadLetterMessageCount;
    this.description = count === undefined ? undefined : formatCount(count, queue);
    this.iconPath = new vscode.ThemeIcon(subQueue === 'active' ? 'mail' : 'warning');
    this.command = {
      command: subQueue === 'active' ? 'sbw.openMessages' : 'sbw.openDeadLetter',
      title: 'Peek Messages',
      arguments: [this],
    };
  }
}

class InfoNode extends vscode.TreeItem {
  constructor(label: string, icon: string, tooltip?: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon(icon);
    this.tooltip = tooltip ?? label;
  }
}

type Node = ConnectionNode | QueueNode | SubQueueNode | InfoNode;

export class ConnectionsTreeProvider implements vscode.TreeDataProvider<Node> {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;

  constructor(private readonly services: Services) {}

  refresh(): void {
    this.emitter.fire();
  }

  getTreeItem(node: Node): vscode.TreeItem {
    return node;
  }

  async getChildren(node?: Node): Promise<Node[]> {
    if (!node) {
      return this.services.connections.list().map((c) => new ConnectionNode(c));
    }
    if (node instanceof ConnectionNode) {
      return this.loadQueues(node.connection);
    }
    if (node instanceof QueueNode) {
      return [
        new SubQueueNode(node.connection, node.queue, 'active'),
        new SubQueueNode(node.connection, node.queue, 'deadLetter'),
      ];
    }
    return [];
  }

  private async loadQueues(connection: ConnectionConfig): Promise<Node[]> {
    try {
      const { admin } = await this.services.clients.get(connection);
      if (connection.kind === 'connectionString' && connection.entityPath) {
        // A queue-scoped connection string can't list the namespace, and may not be able to read counts either.
        const queue = await admin.getQueue(connection.entityPath).catch(() => ({ name: connection.entityPath! }));
        return [new QueueNode(connection, queue)];
      }
      const queues = await admin.listQueues();
      if (queues.length === 0) {
        return [new InfoNode('No queues in this namespace', 'info')];
      }
      return queues.map((q) => new QueueNode(connection, q));
    } catch (err) {
      const message = describeError(err, 'list');
      return [new InfoNode(message, 'error', message)];
    }
  }
}
