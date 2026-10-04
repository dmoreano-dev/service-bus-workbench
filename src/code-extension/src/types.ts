interface ConnectionBase {
  id: string;
  name: string;
  /** Read-only mode: sending, receiving and moving messages are refused. */
  readOnly?: boolean;
}

export type ConnectionConfig =
  | (ConnectionBase & {
      kind: 'connectionString';
      /** Set when the connection string is scoped to a single queue (EntityPath). */
      entityPath?: string;
      /** Set for the local emulator: the port of its HTTP management API. */
      emulatorAdminPort?: number;
    })
  | (ConnectionBase & {
      kind: 'entra';
      fullyQualifiedNamespace: string;
      tenantId?: string;
      /** Where tokens come from: the Microsoft account of VS Code (default) or DefaultAzureCredential (Azure CLI, environment…). */
      credential?: 'vscode' | 'default';
      /** ARM id of the namespace, known when it was picked from a subscription. Lets entities be listed through ARM. */
      resourceId?: string;
    });

/** The protection of a connection that can be changed after it is created. */
export type ConnectionProtection = Pick<ConnectionBase, 'readOnly'>;

export type SubQueue = 'active' | 'deadLetter';

/** Where messages are read from: a queue, or a subscription of a topic. */
export type MessageSource = { queue: string } | { topic: string; subscription: string };

export type PropertyValue = string | number | boolean;

/** A message as typed in the send form. The body is always sent as UTF-8 bytes, exactly as written. */
export interface OutgoingMessage {
  body: string;
  contentType?: string;
  subject?: string;
  messageId?: string;
  correlationId?: string;
  sessionId?: string;
  applicationProperties?: Record<string, PropertyValue>;
}

/** A received/peeked message flattened for display in a webview. */
export interface MessageView {
  sequenceNumber?: string;
  messageId?: string;
  enqueuedTime?: string;
  expiresAt?: string;
  subject?: string;
  contentType?: string;
  correlationId?: string;
  sessionId?: string;
  deliveryCount?: number;
  state?: string;
  deadLetterReason?: string;
  deadLetterErrorDescription?: string;
  deadLetterSource?: string;
  body: string;
  applicationProperties: Record<string, unknown>;
}

export interface QueueInfo {
  name: string;
  activeMessageCount?: number;
  deadLetterMessageCount?: number;
  scheduledMessageCount?: number;
  /** Set when counts were obtained by peeking and stop at this number. */
  countCap?: number;
}

export interface TopicInfo {
  name: string;
  subscriptionCount?: number;
}

export interface SubscriptionInfo {
  topic: string;
  name: string;
  activeMessageCount?: number;
  deadLetterMessageCount?: number;
  /** Set when counts were obtained by peeking and stop at this number. */
  countCap?: number;
}

export type HistoryKind = 'send' | 'resend';

export interface HistoryEntry {
  id: string;
  timestamp: string;
  kind: HistoryKind;
  connectionId: string;
  connectionName: string;
  /** The queue or topic the message was sent to. */
  queue: string;
  /** Where a resend came from, e.g. "dead-letter #42" or "history". */
  origin?: string;
  status: 'ok' | 'error';
  error?: string;
  message: OutgoingMessage;
}
