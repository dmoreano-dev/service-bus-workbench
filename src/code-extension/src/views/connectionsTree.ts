import * as vscode from 'vscode';
import { describeError } from '../errors';
import { Services } from '../services';
import { ConnectionConfig, MessageSource, QueueInfo, SubQueue, SubscriptionInfo, TopicInfo } from '../types';

/** The message counts of a queue or a subscription. */
type Counts = Pick<QueueInfo, 'activeMessageCount' | 'deadLetterMessageCount' | 'countCap'>;

function formatCount(count: number | undefined, counts: Counts): string {
  const value = count ?? 0;
  return counts.countCap !== undefined && value >= counts.countCap ? `${counts.countCap}+` : String(value);
}

function describeCounts(counts: Counts): string | undefined {
  if (counts.activeMessageCount === undefined) {
    return undefined;
  }
  return `${formatCount(counts.activeMessageCount, counts)} active · ${formatCount(counts.deadLetterMessageCount, counts)} dead-letter`;
}

export class ConnectionNode extends vscode.TreeItem {
  constructor(readonly connection: ConnectionConfig) {
    super(connection.name, vscode.TreeItemCollapsibleState.Collapsed);
    // Menus match on the suffix to offer the right read-only toggle.
    this.contextValue = `connection${connection.readOnly ? '.readOnly' : ''}`;
    let icon: string;
    let kind: string;
    if (connection.kind === 'entra') {
      icon = 'azure';
      kind = connection.credential === 'default' ? 'Entra ID (Azure CLI / environment)' : 'Entra ID';
      this.tooltip = connection.fullyQualifiedNamespace;
    } else if (connection.emulatorAdminPort !== undefined) {
      icon = 'vm';
      kind = 'Emulator';
    } else {
      icon = 'key';
      kind = 'Connection string';
    }
    this.iconPath = new vscode.ThemeIcon(icon);
    this.description = connection.readOnly ? `read-only · ${kind}` : kind;
  }
}

/** Groups the queues or the topics of a namespace. */
export class GroupNode extends vscode.TreeItem {
  constructor(
    readonly connection: ConnectionConfig,
    readonly group: 'queues' | 'topics',
  ) {
    super(group === 'queues' ? 'Queues' : 'Topics', vscode.TreeItemCollapsibleState.Expanded);
    this.iconPath = new vscode.ThemeIcon('folder');
  }
}

export class QueueNode extends vscode.TreeItem {
  readonly source: MessageSource;
  /** The entity a message is sent to from this node. */
  readonly sendTarget: string;
  queue: QueueInfo;

  constructor(
    readonly connection: ConnectionConfig,
    queue: QueueInfo,
  ) {
    super(queue.name, vscode.TreeItemCollapsibleState.Collapsed);
    this.source = { queue: queue.name };
    this.sendTarget = queue.name;
    this.contextValue = 'queue';
    this.iconPath = new vscode.ThemeIcon('inbox');
    this.queue = queue;
    this.description = describeCounts(queue);
  }

  /** Replaces the counts in place, so the tree can redraw this node alone. */
  update(queue: QueueInfo): void {
    this.queue = queue;
    this.description = describeCounts(queue);
  }
}

export class TopicNode extends vscode.TreeItem {
  readonly sendTarget: string;

  constructor(
    readonly connection: ConnectionConfig,
    readonly topic: TopicInfo,
  ) {
    super(topic.name, vscode.TreeItemCollapsibleState.Collapsed);
    this.sendTarget = topic.name;
    this.contextValue = 'topic';
    this.iconPath = new vscode.ThemeIcon('broadcast');
    if (topic.subscriptionCount !== undefined) {
      this.description = `${topic.subscriptionCount} subscription${topic.subscriptionCount === 1 ? '' : 's'}`;
    }
  }
}

export class SubscriptionNode extends vscode.TreeItem {
  readonly source: MessageSource;

  constructor(
    readonly connection: ConnectionConfig,
    readonly subscription: SubscriptionInfo,
  ) {
    super(subscription.name, vscode.TreeItemCollapsibleState.Collapsed);
    this.source = { topic: subscription.topic, subscription: subscription.name };
    this.contextValue = 'subscription';
    this.iconPath = new vscode.ThemeIcon('inbox');
    this.description = describeCounts(subscription);
  }
}

export class SubQueueNode extends vscode.TreeItem {
  constructor(
    readonly connection: ConnectionConfig,
    readonly source: MessageSource,
    counts: Counts,
    readonly subQueue: SubQueue,
  ) {
    super(subQueue === 'active' ? 'Messages' : 'Dead-letter', vscode.TreeItemCollapsibleState.None);
    const count = subQueue === 'active' ? counts.activeMessageCount : counts.deadLetterMessageCount;
    this.description = count === undefined ? undefined : formatCount(count, counts);
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

type Node = ConnectionNode | GroupNode | QueueNode | TopicNode | SubscriptionNode | SubQueueNode | InfoNode;

export class ConnectionsTreeProvider implements vscode.TreeDataProvider<Node> {
  private readonly emitter = new vscode.EventEmitter<Node | void>();
  readonly onDidChangeTreeData = this.emitter.event;
  /** The queue and topic nodes on display, to redraw one of them without reloading the rest. */
  private readonly entities = new Map<string, QueueNode | TopicNode>();

  constructor(private readonly services: Services) {}

  refresh(): void {
    this.entities.clear();
    this.emitter.fire();
  }

  /**
   * Reloads the counts of a single queue, or of the subscriptions of a single topic. Does nothing
   * if the entity is not on display.
   */
  async refreshEntity(connectionId: string, entity: string): Promise<void> {
    const node = this.entities.get(entityKey(connectionId, entity));
    if (!node) {
      return;
    }
    if (node instanceof QueueNode) {
      try {
        const { admin } = await this.services.clients.get(node.connection);
        node.update(await admin.getQueue(entity));
      } catch {
        // Keep the counts already shown: a queue-scoped connection string may not be able to read them.
        return;
      }
    }
    // For a topic, this makes the tree ask for its subscriptions again.
    this.emitter.fire(node);
  }

  private track<T extends QueueNode | TopicNode>(node: T): T {
    this.entities.set(entityKey(node.connection.id, node.sendTarget), node);
    return node;
  }

  getTreeItem(node: Node): vscode.TreeItem {
    return node;
  }

  async getChildren(node?: Node): Promise<Node[]> {
    if (!node) {
      return this.services.connections.list().map((c) => new ConnectionNode(c));
    }
    if (node instanceof ConnectionNode) {
      const { connection } = node;
      if (connection.kind === 'connectionString' && connection.entityPath) {
        return this.load(() => this.loadScopedQueue(connection, connection.entityPath!));
      }
      return [new GroupNode(connection, 'queues'), new GroupNode(connection, 'topics')];
    }
    if (node instanceof GroupNode) {
      return this.load(() => (node.group === 'queues' ? this.loadQueues(node.connection) : this.loadTopics(node.connection)));
    }
    if (node instanceof TopicNode) {
      return this.load(() => this.loadSubscriptions(node.connection, node.topic.name));
    }
    if (node instanceof QueueNode) {
      return subQueues(node.connection, node.source, node.queue);
    }
    if (node instanceof SubscriptionNode) {
      return subQueues(node.connection, node.source, node.subscription);
    }
    return [];
  }

  /** Runs a listing and turns a failure into a single node that explains it. */
  private async load(list: () => Promise<Node[]>): Promise<Node[]> {
    try {
      return await list();
    } catch (err) {
      const message = describeError(err, 'list');
      return [new InfoNode(message, 'error', message)];
    }
  }

  private async loadScopedQueue(connection: ConnectionConfig, entityPath: string): Promise<Node[]> {
    const { admin } = await this.services.clients.get(connection);
    // A queue-scoped connection string can't list the namespace, and may not be able to read counts either.
    const queue = await admin.getQueue(entityPath).catch(() => ({ name: entityPath }));
    return [this.track(new QueueNode(connection, queue))];
  }

  private async loadQueues(connection: ConnectionConfig): Promise<Node[]> {
    const { admin } = await this.services.clients.get(connection);
    const queues = await admin.listQueues();
    if (queues.length === 0) {
      return [new InfoNode('No queues in this namespace', 'info')];
    }
    return queues.map((q) => this.track(new QueueNode(connection, q)));
  }

  private async loadTopics(connection: ConnectionConfig): Promise<Node[]> {
    const { admin } = await this.services.clients.get(connection);
    const topics = await admin.listTopics();
    if (topics.length === 0) {
      return [new InfoNode('No topics in this namespace', 'info')];
    }
    return topics.map((t) => this.track(new TopicNode(connection, t)));
  }

  private async loadSubscriptions(connection: ConnectionConfig, topic: string): Promise<Node[]> {
    const { admin } = await this.services.clients.get(connection);
    const subscriptions = await admin.listSubscriptions(topic);
    if (subscriptions.length === 0) {
      return [new InfoNode('No subscriptions in this topic', 'info')];
    }
    return subscriptions.map((s) => new SubscriptionNode(connection, s));
  }
}

function entityKey(connectionId: string, entity: string): string {
  return `${connectionId}/${entity}`;
}

function subQueues(connection: ConnectionConfig, source: MessageSource, counts: Counts): Node[] {
  return [
    new SubQueueNode(connection, source, counts, 'active'),
    new SubQueueNode(connection, source, counts, 'deadLetter'),
  ];
}
