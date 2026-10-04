// Fills the local emulator with sample messages, including a few dead-letters.
// Usage: npm run seed:local   (the AppHost in src/aspire must be running)
import { ServiceBusClient } from '@azure/service-bus';

const CONNECTION_STRING =
  'Endpoint=sb://localhost;SharedAccessKeyName=RootManageSharedAccessKey;SharedAccessKey=SAS_KEY_VALUE;UseDevelopmentEmulator=true;';

const json = (value) => Buffer.from(JSON.stringify(value), 'utf8');

const REASONS = [
  { reason: 'ValidationFailed', description: 'Required field "customer" is missing' },
  { reason: 'MaxDeliveryCountExceeded', description: 'Message could not be consumed after 3 delivery attempts' },
  { reason: 'DownstreamTimeout', description: 'Inventory service did not respond within 30s' },
];

const seed = {
  orders: {
    messages: Array.from({ length: 150 }, (_, i) => ({
      body: json({ orderId: 1000 + i, customer: `customer-${i % 4}`, total: 25 * (i + 1) }),
      contentType: 'application/json',
      subject: 'OrderCreated',
      messageId: `order-${1000 + i}`,
      correlationId: `checkout-${i}`,
      applicationProperties: { tenant: i % 2 === 0 ? 'acme' : 'globex', priority: i % 3 },
    })),
    deadLetter: 30,
  },
  payments: {
    messages: Array.from({ length: 60 }, (_, i) => ({
      body: json({ paymentId: `pay-${i}`, amount: 99.9 + i, currency: 'USD' }),
      contentType: 'application/json',
      subject: 'PaymentRequested',
    })),
    deadLetter: 8,
  },
  notifications: {
    messages: [
      { body: Buffer.from('Plain text notification', 'utf8'), contentType: 'text/plain', subject: 'Email' },
      { body: Buffer.from('<note><to>ops</to></note>', 'utf8'), contentType: 'application/xml', subject: 'Xml' },
      ...Array.from({ length: 6 }, (_, i) => ({
        body: json({ channel: i % 2 === 0 ? 'email' : 'sms', to: `user-${i}@example.com`, template: 'welcome' }),
        contentType: 'application/json',
        subject: 'NotificationRequested',
      })),
    ],
    deadLetter: 0,
  },
};

// Every subscription gets a copy of the topic's messages; `deadLetter` is per subscription.
const topicSeed = {
  'order-events': {
    messages: Array.from({ length: 40 }, (_, i) => ({
      body: json({ orderId: 2000 + i, status: i % 5 === 0 ? 'cancelled' : 'confirmed' }),
      contentType: 'application/json',
      subject: i % 5 === 0 ? 'OrderCancelled' : 'OrderConfirmed',
      messageId: `order-event-${2000 + i}`,
      applicationProperties: { tenant: i % 2 === 0 ? 'acme' : 'globex' },
    })),
    deadLetter: { billing: 6 },
  },
  alerts: {
    messages: Array.from({ length: 5 }, (_, i) => ({
      body: json({ severity: i % 2 === 0 ? 'warning' : 'critical', text: `Alert ${i}` }),
      contentType: 'application/json',
      subject: 'AlertRaised',
    })),
    deadLetter: {},
  },
};

async function send(client, queueOrTopic, messages) {
  const sender = client.createSender(queueOrTopic);
  await sender.sendMessages(messages);
  await sender.close();
}

async function deadLetter(receiver, count) {
  let moved = 0;
  // A single receive call may return fewer messages than requested.
  while (moved < count) {
    const received = await receiver.receiveMessages(count - moved, { maxWaitTimeInMs: 5000 });
    if (received.length === 0) {
      break;
    }
    for (const message of received) {
      const reason = REASONS[moved % REASONS.length];
      await receiver.deadLetterMessage(message, {
        deadLetterReason: reason.reason,
        deadLetterErrorDescription: reason.description,
      });
      moved++;
    }
  }
  await receiver.close();
}

const client = new ServiceBusClient(CONNECTION_STRING);
try {
  for (const [queue, { messages, deadLetter: count }] of Object.entries(seed)) {
    await send(client, queue, messages);
    if (count > 0) {
      await deadLetter(client.createReceiver(queue), count);
    }
    console.log(`${queue}: sent ${messages.length}, dead-lettered ${count}`);
  }
  for (const [topic, { messages, deadLetter: bySubscription }] of Object.entries(topicSeed)) {
    await send(client, topic, messages);
    for (const [subscription, count] of Object.entries(bySubscription)) {
      await deadLetter(client.createReceiver(topic, subscription), count);
    }
    console.log(`${topic}: sent ${messages.length}, dead-lettered ${JSON.stringify(bySubscription)}`);
  }
} catch (err) {
  console.error(`Seeding failed: ${err.message}\nIs the emulator running? Start it with: dotnet run --project ../aspire/ServiceBusLocal.AppHost`);
  process.exitCode = 1;
} finally {
  await client.close();
}
