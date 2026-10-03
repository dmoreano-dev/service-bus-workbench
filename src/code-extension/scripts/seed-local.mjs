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

const client = new ServiceBusClient(CONNECTION_STRING);
try {
  for (const [queue, { messages, deadLetter }] of Object.entries(seed)) {
    const sender = client.createSender(queue);
    await sender.sendMessages(messages);
    await sender.close();

    if (deadLetter > 0) {
      const receiver = client.createReceiver(queue);
      let moved = 0;
      // A single receive call may return fewer messages than requested.
      while (moved < deadLetter) {
        const received = await receiver.receiveMessages(deadLetter - moved, { maxWaitTimeInMs: 5000 });
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
    console.log(`${queue}: sent ${messages.length}, dead-lettered ${deadLetter}`);
  }
} catch (err) {
  console.error(`Seeding failed: ${err.message}\nIs the emulator running? Start it with: dotnet run --project ../aspire/ServiceBusLocal.AppHost`);
  process.exitCode = 1;
} finally {
  await client.close();
}
