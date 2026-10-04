// Runs against the local Service Bus emulator (start the AppHost in src/aspire). The tests send and
// delete messages, so they only touch the entities the AppHost reserves for them. Everything is
// skipped when the emulator is not running or those entities do not exist.
import { ServiceBusClient } from '@azure/service-bus';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { emulatorAdmin } from '../../src/serviceBus/admin';
import { moveFromDeadLetter, moveSelectedFromDeadLetter, peek, receiveAndDelete, send, toView } from '../../src/serviceBus/operations';
import { MessageSource } from '../../src/types';

const CONNECTION_STRING =
  'Endpoint=sb://localhost;SharedAccessKeyName=RootManageSharedAccessKey;SharedAccessKey=SAS_KEY_VALUE;UseDevelopmentEmulator=true;';
const ADMIN_URL = 'http://localhost:5300';
const QUEUE = 'sbw-tests';
const TOPIC = 'sbw-tests-topic';
const SUBSCRIPTION = 'all';

const queue: MessageSource = { queue: QUEUE };
const subscription: MessageSource = { topic: TOPIC, subscription: SUBSCRIPTION };

async function emulatorIsReady(): Promise<boolean> {
  try {
    const health = await fetch(`${ADMIN_URL}/health`, { signal: AbortSignal.timeout(2000) });
    if (!health.ok) {
      return false;
    }
    const probe = new ServiceBusClient(CONNECTION_STRING);
    try {
      const queues = await emulatorAdmin(ADMIN_URL, probe).listQueues();
      return queues.some((q) => q.name === QUEUE);
    } finally {
      await probe.close();
    }
  } catch {
    return false;
  }
}

describe('against the emulator', () => {
  const client = new ServiceBusClient(CONNECTION_STRING);
  const admin = emulatorAdmin(ADMIN_URL, client);
  let ready = false;

  beforeAll(async () => {
    ready = await emulatorIsReady();
    if (!ready) {
      console.warn(`Skipping: the emulator is not running, or it has no "${QUEUE}" queue. Start the AppHost first.`);
    }
  });

  /** Removes whatever a source holds, in both its sub-queues. */
  const drain = async (source: MessageSource) => {
    for (const subQueue of ['active', 'deadLetter'] as const) {
      // Peek first: receiving from an empty entity waits five seconds, peeking returns at once.
      while ((await peek(client, source, subQueue, 1)).length > 0) {
        await receiveAndDelete(client, source, subQueue, 100);
      }
    }
  };

  /** Dead-letters every active message of a source. */
  const deadLetterAll = async (source: MessageSource) => {
    const receiver = 'queue' in source ? client.createReceiver(source.queue) : client.createReceiver(source.topic, source.subscription);
    try {
      for (const message of await receiver.receiveMessages(100, { maxWaitTimeInMs: 5000 })) {
        await receiver.deadLetterMessage(message, { deadLetterReason: 'TestReason', deadLetterErrorDescription: 'test' });
      }
    } finally {
      await receiver.close();
    }
  };

  beforeEach(async (context) => {
    if (!ready) {
      context.skip();
    }
    await drain(queue);
    await drain(subscription);
  });

  afterAll(async () => {
    await client.close();
  });

  it('lists queues, topics and subscriptions', async () => {
    expect((await admin.listQueues()).map((q) => q.name)).toContain(QUEUE);
    expect((await admin.listTopics()).map((t) => t.name)).toContain(TOPIC);
    expect((await admin.listSubscriptions(TOPIC)).map((s) => s.name)).toEqual([SUBSCRIPTION]);
  });

  it('sends the body as the exact bytes written, and peeks it back', async () => {
    await send(client, QUEUE, { body: '{"a":"ñ"}', contentType: 'application/json', subject: 'Test', applicationProperties: { n: 1 } });
    const [view] = (await peek(client, queue, 'active', 10)).map(toView);
    expect(view.body).toBe('{"a":"ñ"}');
    expect(view.subject).toBe('Test');
    expect(view.applicationProperties).toEqual({ n: 1 });
  });

  it('peeks from the start every time and pages with a sequence number', async () => {
    for (let i = 0; i < 5; i++) {
      await send(client, QUEUE, { body: `m${i}` });
    }
    const first = await peek(client, queue, 'active', 2);
    expect(first.map((m) => toView(m).body)).toEqual(['m0', 'm1']);
    const again = await peek(client, queue, 'active', 2);
    expect(again.map((m) => toView(m).body)).toEqual(['m0', 'm1']);
    const next = await peek(client, queue, 'active', 10, first[1].sequenceNumber!.add(1));
    expect(next.map((m) => toView(m).body)).toEqual(['m2', 'm3', 'm4']);
  });

  it('counts messages by peeking', async () => {
    await send(client, QUEUE, { body: 'one' });
    await send(client, QUEUE, { body: 'two' });
    expect(await admin.getQueue(QUEUE)).toMatchObject({ activeMessageCount: 2, deadLetterMessageCount: 0 });
  });

  it('receives and deletes', async () => {
    await send(client, QUEUE, { body: 'gone' });
    const received = await receiveAndDelete(client, queue, 'active', 10);
    expect(received.map((m) => toView(m).body)).toEqual(['gone']);
    expect(await peek(client, queue, 'active', 10)).toHaveLength(0);
  });

  it('delivers a message sent to a topic to its subscription', async () => {
    await send(client, TOPIC, { body: 'event' });
    // The topic hands the message to its subscriptions a moment after the send returns.
    const started = Date.now();
    let peeked = await peek(client, subscription, 'active', 10);
    while (peeked.length === 0 && Date.now() - started < 10_000) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      peeked = await peek(client, subscription, 'active', 10);
    }
    expect(peeked.map((m) => toView(m).body)).toEqual(['event']);
  });

  it('moves dead-lettered messages back, oldest first', async () => {
    for (const body of ['a', 'b', 'c']) {
      await send(client, QUEUE, { body });
    }
    await deadLetterAll(queue);
    expect(await peek(client, queue, 'deadLetter', 10)).toHaveLength(3);

    const result = await moveFromDeadLetter(client, queue, 2, (m) => send(client, QUEUE, { body: toView(m).body }));

    expect(result).toEqual({ moved: 2 });
    expect((await peek(client, queue, 'active', 10)).map((m) => toView(m).body)).toEqual(['a', 'b']);
    expect((await peek(client, queue, 'deadLetter', 10)).map((m) => toView(m).body)).toEqual(['c']);
  });

  it('moves only the selected dead-lettered messages', async () => {
    for (const body of ['a', 'b', 'c', 'd']) {
      await send(client, QUEUE, { body });
    }
    await deadLetterAll(queue);
    const deadLettered = (await peek(client, queue, 'deadLetter', 10)).map(toView);
    const selected = deadLettered.filter((m) => m.body === 'b' || m.body === 'c').map((m) => m.sequenceNumber!);

    const result = await moveSelectedFromDeadLetter(client, queue, [...selected, '999999'], (m) =>
      send(client, QUEUE, { body: toView(m).body }),
    );

    expect(result).toEqual({ moved: 2, missing: 1 });
    expect((await peek(client, queue, 'active', 10)).map((m) => toView(m).body)).toEqual(['b', 'c']);
    // The ones that were skipped are released and stay in the dead-letter queue.
    expect((await receiveAndDelete(client, queue, 'deadLetter', 10)).map((m) => toView(m).body).sort()).toEqual(['a', 'd']);
  });

  it('leaves a message in the dead-letter queue when it cannot be forwarded', async () => {
    await send(client, QUEUE, { body: 'stuck' });
    await deadLetterAll(queue);

    const result = await moveFromDeadLetter(client, queue, 5, async () => {
      throw new Error('cannot send');
    });

    expect(result.moved).toBe(0);
    expect(result.error).toBeInstanceOf(Error);
    expect((await peek(client, queue, 'deadLetter', 10)).map((m) => toView(m).body)).toEqual(['stuck']);
  });

  it('moves the dead-letters of a subscription back to its topic', async () => {
    await send(client, TOPIC, { body: 'retry me' });
    await deadLetterAll(subscription);

    const result = await moveFromDeadLetter(client, subscription, 10, (m) => send(client, TOPIC, { body: toView(m).body }));

    expect(result).toEqual({ moved: 1 });
    expect((await peek(client, subscription, 'active', 10)).map((m) => toView(m).body)).toEqual(['retry me']);
    expect(await peek(client, subscription, 'deadLetter', 10)).toHaveLength(0);
  });
});
