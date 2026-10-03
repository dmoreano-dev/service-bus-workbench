export type ConnectionConfig =
  | {
      id: string;
      name: string;
      kind: 'connectionString';
      /** Set when the connection string is scoped to a single queue (EntityPath). */
      entityPath?: string;
      /** Set for the local emulator: the port of its HTTP management API. */
      emulatorAdminPort?: number;
    }
  | {
      id: string;
      name: string;
      kind: 'entra';
      fullyQualifiedNamespace: string;
      tenantId?: string;
    };

export type SubQueue = 'active' | 'deadLetter';

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

export type HistoryKind = 'send' | 'resend';

export interface HistoryEntry {
  id: string;
  timestamp: string;
  kind: HistoryKind;
  connectionId: string;
  connectionName: string;
  queue: string;
  /** Where a resend came from, e.g. "dead-letter #42" or "history". */
  origin?: string;
  status: 'ok' | 'error';
  error?: string;
  message: OutgoingMessage;
}
