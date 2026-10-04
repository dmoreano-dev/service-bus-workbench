import {
  ServiceBusClient,
  ServiceBusMessage,
  ServiceBusReceivedMessage,
  ServiceBusReceiver,
  ServiceBusReceiverOptions,
} from '@azure/service-bus';
import Long from 'long';
import { MessageSource, MessageView, OutgoingMessage, PropertyValue, SubQueue } from '../types';

export type SequenceNumber = NonNullable<ServiceBusReceivedMessage['sequenceNumber']>;

function receiverOptions(subQueue: SubQueue): ServiceBusReceiverOptions {
  // skipParsingBodyAsJson keeps the raw bytes, so a resend reproduces the original payload exactly.
  return {
    skipParsingBodyAsJson: true,
    ...(subQueue === 'deadLetter' ? { subQueueType: 'deadLetter' as const } : {}),
  };
}

function createReceiver(
  client: ServiceBusClient,
  source: MessageSource,
  options: ServiceBusReceiverOptions,
): ServiceBusReceiver {
  return 'queue' in source
    ? client.createReceiver(source.queue, options)
    : client.createReceiver(source.topic, source.subscription, options);
}

/** A short name for a source: the queue name, or "topic/subscription". */
export function sourceName(source: MessageSource): string {
  return 'queue' in source ? source.queue : `${source.topic}/${source.subscription}`;
}

/** Peeks up to `count` messages without locking or removing them. */
export async function peek(
  client: ServiceBusClient,
  source: MessageSource,
  subQueue: SubQueue,
  count: number,
  from?: SequenceNumber,
): Promise<ServiceBusReceivedMessage[]> {
  const receiver = createReceiver(client, source, receiverOptions(subQueue));
  try {
    const messages: ServiceBusReceivedMessage[] = [];
    // Always pass an explicit position: without one the SDK resumes from the last peek made
    // on this entity by any receiver of the same client, so a fresh peek could come back empty.
    let next: SequenceNumber = from ?? Long.ZERO;
    // A single peek call may return fewer messages than requested, so keep asking.
    while (messages.length < count) {
      const batch = await receiver.peekMessages(count - messages.length, { fromSequenceNumber: next });
      const last = batch[batch.length - 1]?.sequenceNumber;
      if (!last) {
        break;
      }
      messages.push(...batch);
      next = last.add(1);
    }
    return messages;
  } finally {
    await receiver.close();
  }
}

/** Receives up to `count` messages and removes them from the queue or subscription. This cannot be undone. */
export async function receiveAndDelete(
  client: ServiceBusClient,
  source: MessageSource,
  subQueue: SubQueue,
  count: number,
): Promise<ServiceBusReceivedMessage[]> {
  const receiver = createReceiver(client, source, { ...receiverOptions(subQueue), receiveMode: 'receiveAndDelete' });
  try {
    return await receiver.receiveMessages(count, { maxWaitTimeInMs: 5000 });
  } finally {
    await receiver.close();
  }
}

/** Messages locked per round trip when moving; small enough to finish well inside the lock duration. */
const MOVE_BATCH_SIZE = 20;

export interface MoveResult {
  moved: number;
  /** Set when the move stopped early: the failure of the message that could not be forwarded or removed. */
  error?: unknown;
}

/**
 * Takes up to `count` messages out of a dead-letter queue. Each one is locked, handed to `forward`
 * and removed only once `forward` succeeds, so a failure never loses a message: it stays in the
 * dead-letter queue. Stops at the first failure.
 */
export async function moveFromDeadLetter(
  client: ServiceBusClient,
  source: MessageSource,
  count: number,
  forward: (message: ServiceBusReceivedMessage) => Promise<void>,
): Promise<MoveResult> {
  const receiver = createReceiver(client, source, receiverOptions('deadLetter'));
  let moved = 0;
  try {
    while (moved < count) {
      const batch = await receiver.receiveMessages(Math.min(MOVE_BATCH_SIZE, count - moved), { maxWaitTimeInMs: 5000 });
      if (batch.length === 0) {
        break;
      }
      for (let i = 0; i < batch.length; i++) {
        try {
          await forward(batch[i]);
          await receiver.completeMessage(batch[i]);
          moved++;
        } catch (error) {
          // Release the rest of the batch right away instead of waiting for the locks to expire.
          await Promise.all(batch.slice(i).map((m) => receiver.abandonMessage(m).catch(() => undefined)));
          return { moved, error };
        }
      }
    }
    return { moved };
  } finally {
    await receiver.close();
  }
}

export interface SelectiveMoveResult extends MoveResult {
  /** Selected messages that were no longer in the dead-letter queue. */
  missing: number;
}

/**
 * Takes the messages with the given sequence numbers out of a dead-letter queue, with the same
 * guarantee as moveFromDeadLetter. Service Bus cannot receive a message by its sequence number, so
 * this receives from the oldest one on, keeps the ones that were not selected locked so they are
 * not delivered again, and releases them at the end. It stops once it has gone past the newest
 * selected message.
 */
export async function moveSelectedFromDeadLetter(
  client: ServiceBusClient,
  source: MessageSource,
  sequenceNumbers: string[],
  forward: (message: ServiceBusReceivedMessage) => Promise<void>,
): Promise<SelectiveMoveResult> {
  const wanted = new Set(sequenceNumbers);
  if (wanted.size === 0) {
    return { moved: 0, missing: 0 };
  }
  const newest = sequenceNumbers.map((n) => Long.fromString(n)).reduce((a, b) => (a.greaterThan(b) ? a : b));
  const receiver = createReceiver(client, source, receiverOptions('deadLetter'));
  const skipped: ServiceBusReceivedMessage[] = [];
  let moved = 0;
  try {
    while (wanted.size > 0) {
      const batch = await receiver.receiveMessages(MOVE_BATCH_SIZE, { maxWaitTimeInMs: 5000 });
      if (batch.length === 0) {
        break;
      }
      let pastNewest = false;
      for (let i = 0; i < batch.length; i++) {
        const sequenceNumber = batch[i].sequenceNumber;
        const key = sequenceNumber?.toString();
        pastNewest ||= !!sequenceNumber && sequenceNumber.greaterThan(newest);
        if (!key || !wanted.has(key)) {
          skipped.push(batch[i]);
          continue;
        }
        try {
          await forward(batch[i]);
          await receiver.completeMessage(batch[i]);
          wanted.delete(key);
          moved++;
        } catch (error) {
          skipped.push(...batch.slice(i));
          return { moved, error, missing: 0 };
        }
      }
      if (pastNewest) {
        break;
      }
    }
    return { moved, missing: wanted.size };
  } finally {
    await Promise.all(skipped.map((m) => receiver.abandonMessage(m).catch(() => undefined)));
    await receiver.close();
  }
}

/** Sends a message to a queue or a topic. */
export async function send(client: ServiceBusClient, queueOrTopic: string, message: OutgoingMessage): Promise<void> {
  // A Buffer body is sent as-is; a string would be JSON-encoded by the SDK and gain quotes.
  const outgoing: ServiceBusMessage = { body: Buffer.from(message.body, 'utf8') };
  if (message.contentType) outgoing.contentType = message.contentType;
  if (message.subject) outgoing.subject = message.subject;
  if (message.messageId) outgoing.messageId = message.messageId;
  if (message.correlationId) outgoing.correlationId = message.correlationId;
  if (message.sessionId) outgoing.sessionId = message.sessionId;
  if (message.applicationProperties && Object.keys(message.applicationProperties).length > 0) {
    outgoing.applicationProperties = message.applicationProperties;
  }
  const sender = client.createSender(queueOrTopic);
  try {
    await sender.sendMessages(outgoing);
  } finally {
    await sender.close();
  }
}

export function toView(message: ServiceBusReceivedMessage): MessageView {
  return {
    sequenceNumber: message.sequenceNumber?.toString(),
    messageId: message.messageId === undefined ? undefined : String(message.messageId),
    enqueuedTime: message.enqueuedTimeUtc?.toISOString(),
    expiresAt: message.expiresAtUtc?.toISOString(),
    subject: message.subject,
    contentType: message.contentType,
    correlationId: message.correlationId === undefined ? undefined : String(message.correlationId),
    sessionId: message.sessionId,
    deliveryCount: message.deliveryCount,
    state: message.state,
    deadLetterReason: message.deadLetterReason,
    deadLetterErrorDescription: message.deadLetterErrorDescription,
    deadLetterSource: message.deadLetterSource,
    body: bodyToString(message.body),
    applicationProperties: { ...(message.applicationProperties ?? {}) },
  };
}

/** Application properties Service Bus adds when it dead-letters a message; a resent copy must not carry them. */
const DEAD_LETTER_PROPERTIES = new Set(['DeadLetterReason', 'DeadLetterErrorDescription']);

/** The message to send in order to resend one that was read. */
export function toOutgoing(view: MessageView): OutgoingMessage {
  const applicationProperties: Record<string, PropertyValue> = {};
  for (const [key, value] of Object.entries(view.applicationProperties)) {
    if (DEAD_LETTER_PROPERTIES.has(key)) {
      continue;
    }
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      applicationProperties[key] = value;
    }
  }
  return {
    body: view.body,
    contentType: view.contentType,
    subject: view.subject,
    messageId: view.messageId,
    correlationId: view.correlationId,
    sessionId: view.sessionId,
    applicationProperties,
  };
}

/** The queue or topic a message read from `source` is sent back to. */
export function resendTarget(source: MessageSource): string {
  // A message read from a subscription goes back to its topic, so every subscription receives it again.
  return 'queue' in source ? source.queue : source.topic;
}

export function bodyToString(body: unknown): string {
  if (body === undefined || body === null) {
    return '';
  }
  if (typeof body === 'string') {
    return body;
  }
  if (body instanceof Uint8Array) {
    return Buffer.from(body).toString('utf8');
  }
  return JSON.stringify(body, null, 2);
}
