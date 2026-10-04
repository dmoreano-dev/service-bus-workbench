import { ServiceBusReceivedMessage } from '@azure/service-bus';
import Long from 'long';
import { describe, expect, it } from 'vitest';
import { bodyToString, resendTarget, sourceName, toOutgoing, toView } from '../../src/serviceBus/operations';
import { MessageView } from '../../src/types';

describe('bodyToString', () => {
  it('decodes bytes as UTF-8 without altering them', () => {
    expect(bodyToString(Buffer.from('{"a":"ñ"}', 'utf8'))).toBe('{"a":"ñ"}');
    expect(bodyToString(new Uint8Array([104, 105]))).toBe('hi');
  });

  it('returns strings as they are and nothing for an empty body', () => {
    expect(bodyToString('plain')).toBe('plain');
    expect(bodyToString(undefined)).toBe('');
    expect(bodyToString(null)).toBe('');
  });

  it('serialises anything else as JSON', () => {
    expect(bodyToString({ a: 1 })).toBe('{\n  "a": 1\n}');
  });
});

describe('toView', () => {
  it('flattens a received message for display', () => {
    const received = {
      body: Buffer.from('hello', 'utf8'),
      sequenceNumber: Long.fromNumber(42),
      messageId: 7,
      correlationId: 'c-1',
      subject: 'Greeting',
      contentType: 'text/plain',
      deliveryCount: 3,
      enqueuedTimeUtc: new Date('2026-10-01T10:00:00Z'),
      deadLetterReason: 'ValidationFailed',
      applicationProperties: { tenant: 'acme' },
    } as unknown as ServiceBusReceivedMessage;
    expect(toView(received)).toMatchObject({
      body: 'hello',
      sequenceNumber: '42',
      messageId: '7',
      correlationId: 'c-1',
      subject: 'Greeting',
      deliveryCount: 3,
      enqueuedTime: '2026-10-01T10:00:00.000Z',
      deadLetterReason: 'ValidationFailed',
      applicationProperties: { tenant: 'acme' },
    });
  });

  it('copes with a message that has no properties', () => {
    const view = toView({ body: undefined } as unknown as ServiceBusReceivedMessage);
    expect(view.body).toBe('');
    expect(view.applicationProperties).toEqual({});
    expect(view.sequenceNumber).toBeUndefined();
  });
});

describe('toOutgoing', () => {
  const view: MessageView = {
    body: '{"orderId":1}',
    contentType: 'application/json',
    subject: 'OrderCreated',
    messageId: 'order-1',
    correlationId: 'checkout-1',
    sessionId: 's-1',
    sequenceNumber: '12',
    applicationProperties: {
      tenant: 'acme',
      priority: 2,
      urgent: true,
      DeadLetterReason: 'ValidationFailed',
      DeadLetterErrorDescription: 'missing field',
      when: new Date(0),
      nothing: null,
    },
  };

  it('keeps the body, the IDs and the properties', () => {
    expect(toOutgoing(view)).toMatchObject({
      body: '{"orderId":1}',
      contentType: 'application/json',
      subject: 'OrderCreated',
      messageId: 'order-1',
      correlationId: 'checkout-1',
      sessionId: 's-1',
    });
  });

  it('drops the dead-letter properties and values that cannot be sent', () => {
    expect(toOutgoing(view).applicationProperties).toEqual({ tenant: 'acme', priority: 2, urgent: true });
  });
});

describe('message sources', () => {
  it('names a queue and a subscription', () => {
    expect(sourceName({ queue: 'orders' })).toBe('orders');
    expect(sourceName({ topic: 'order-events', subscription: 'billing' })).toBe('order-events/billing');
  });

  it('resends a subscription message to its topic', () => {
    expect(resendTarget({ queue: 'orders' })).toBe('orders');
    expect(resendTarget({ topic: 'order-events', subscription: 'billing' })).toBe('order-events');
  });
});
