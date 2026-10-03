import {
  ServiceBusClient,
  ServiceBusMessage,
  ServiceBusReceivedMessage,
  ServiceBusReceiverOptions,
} from '@azure/service-bus';
import Long from 'long';
import { MessageView, OutgoingMessage, SubQueue } from '../types';

export type SequenceNumber = NonNullable<ServiceBusReceivedMessage['sequenceNumber']>;

function receiverOptions(subQueue: SubQueue): ServiceBusReceiverOptions {
  // skipParsingBodyAsJson keeps the raw bytes, so a resend reproduces the original payload exactly.
  return {
    skipParsingBodyAsJson: true,
    ...(subQueue === 'deadLetter' ? { subQueueType: 'deadLetter' as const } : {}),
  };
}

/** Peeks up to `count` messages without locking or removing them. */
export async function peek(
  client: ServiceBusClient,
  queue: string,
  subQueue: SubQueue,
  count: number,
  from?: SequenceNumber,
): Promise<ServiceBusReceivedMessage[]> {
  const receiver = client.createReceiver(queue, receiverOptions(subQueue));
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

/** Receives up to `count` messages and removes them from the queue. This cannot be undone. */
export async function receiveAndDelete(
  client: ServiceBusClient,
  queue: string,
  subQueue: SubQueue,
  count: number,
): Promise<ServiceBusReceivedMessage[]> {
  const receiver = client.createReceiver(queue, { ...receiverOptions(subQueue), receiveMode: 'receiveAndDelete' });
  try {
    return await receiver.receiveMessages(count, { maxWaitTimeInMs: 5000 });
  } finally {
    await receiver.close();
  }
}

export async function send(client: ServiceBusClient, queue: string, message: OutgoingMessage): Promise<void> {
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
  const sender = client.createSender(queue);
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
