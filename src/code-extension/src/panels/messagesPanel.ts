import * as vscode from 'vscode';
import type { ServiceBusReceivedMessage } from '@azure/service-bus';
import { describeError } from '../errors';
import { assertWritable, confirmDestructive } from '../protection';
import {
  moveFromDeadLetter,
  moveSelectedFromDeadLetter,
  peek,
  receiveAndDelete,
  resendTarget,
  SequenceNumber,
  sourceName,
  toOutgoing,
  toView,
} from '../serviceBus/operations';
import { sendAndRecord, Services } from '../services';
import { ConnectionConfig, MessageSource, MessageView, SubQueue } from '../types';
import { BANNER, protectionOf, renderHtml, webviewOptions } from '../webview/html';
import { SendPanel } from './sendPanel';

type FromWebview =
  | { type: 'ready' }
  | { type: 'peek'; count: number }
  | { type: 'more'; count: number }
  | { type: 'receiveDelete'; count: number }
  | { type: 'resend'; index: number }
  | { type: 'resendMany'; indexes: number[] }
  | { type: 'moveBack'; count: number; indexes: number[] };

const BODY = `
${BANNER}
<div class="toolbar">
  <label>Count <input id="count" type="number" min="1" max="500"></label>
  <button id="peek">Peek</button>
  <button id="more" class="secondary">Load more</button>
  <span class="spacer"></span>
  <button id="resendSelected" class="secondary write">Resend selected…</button>
  <button id="moveBack" class="secondary write hidden">Move back…</button>
  <button id="receiveDelete" class="danger write">Receive and delete…</button>
</div>
<div id="status" class="status"></div>
<div class="table-wrap">
  <div id="loading" class="loading hidden"><div class="spinner"></div><span id="loadingText"></span></div>
  <table>
    <thead><tr><th class="check"><input id="checkAll" type="checkbox" title="Select all"></th><th>Seq</th><th>Enqueued</th><th>Message ID</th><th>Subject</th><th>Deliveries</th><th>Body</th></tr></thead>
    <tbody id="rows"></tbody>
  </table>
</div>
<div id="details" class="details hidden">
  <div class="toolbar">
    <strong id="detailsTitle"></strong>
    <span class="spacer"></span>
    <button id="resend" class="secondary write">Resend…</button>
  </div>
  <dl id="props"></dl>
  <pre id="body"></pre>
</div>`;

/** One webview per queue or subscription and sub-queue, showing peeked (or just-received) messages. */
export class MessagesPanel {
  private static readonly open = new Map<string, MessagesPanel>();

  static show(
    services: Services,
    extensionUri: vscode.Uri,
    connection: ConnectionConfig,
    source: MessageSource,
    subQueue: SubQueue,
  ): void {
    const key = `${connection.id}/${JSON.stringify(source)}/${subQueue}`;
    const existing = MessagesPanel.open.get(key);
    if (existing) {
      existing.panel.reveal();
      return;
    }
    MessagesPanel.open.set(key, new MessagesPanel(key, services, extensionUri, connection, source, subQueue));
  }

  private readonly panel: vscode.WebviewPanel;
  private messages: MessageView[] = [];
  private nextSequence: SequenceNumber | undefined;

  private constructor(
    key: string,
    private readonly services: Services,
    private readonly extensionUri: vscode.Uri,
    private readonly connection: ConnectionConfig,
    private readonly source: MessageSource,
    private readonly subQueue: SubQueue,
  ) {
    const name = sourceName(source);
    const title = subQueue === 'deadLetter' ? `${name} (dead-letter)` : name;
    this.panel = vscode.window.createWebviewPanel('sbw.messages', title, vscode.ViewColumn.Active, webviewOptions(extensionUri));
    this.panel.webview.html = renderHtml(this.panel.webview, extensionUri, 'messages.js', BODY);
    const protection = services.connections.onDidChange(() => this.post({ type: 'protection', ...protectionOf(this.current) }));
    this.panel.onDidDispose(() => {
      MessagesPanel.open.delete(key);
      protection.dispose();
    });
    this.panel.webview.onDidReceiveMessage((m: FromWebview) => this.handle(m));
  }

  /** The connection as it is now: its protection may have changed since the panel was opened. */
  private get current(): ConnectionConfig {
    return this.services.connections.get(this.connection.id) ?? this.connection;
  }

  /** "queue" or "subscription", for texts shown to the user. */
  private get entity(): string {
    return 'queue' in this.source ? 'queue' : 'subscription';
  }

  private get label(): string {
    const name = `"${sourceName(this.source)}"`;
    return this.subQueue === 'deadLetter' ? `the dead-letter queue of ${name}` : name;
  }

  private async handle(message: FromWebview): Promise<void> {
    switch (message.type) {
      case 'ready': {
        const count = vscode.workspace.getConfiguration('serviceBusWorkbench').get<number>('peekBatchSize', 50);
        this.post({ type: 'init', count, deadLetter: this.subQueue === 'deadLetter', ...protectionOf(this.current) });
        return this.peek(count, false);
      }
      case 'peek':
        return this.peek(message.count, false);
      case 'more':
        return this.peek(message.count, true);
      case 'receiveDelete':
        return this.receiveAndDelete(message.count);
      case 'resend':
        return this.resend(message.index);
      case 'resendMany':
        return this.resendMany(message.indexes);
      case 'moveBack':
        return this.moveBack(message.count, message.indexes);
    }
  }

  private async peek(count: number, append: boolean): Promise<void> {
    await this.run('peek', 'Peeking messages…', async () => {
      const added = await this.load(count, append);
      const status =
        append && added === 0 ? 'No more messages.' : `Peeked ${this.messages.length} message(s). Nothing was removed.`;
      this.post({ type: 'status', text: status });
    });
  }

  /** Peeks into the queue or subscription and shows the result. Returns how many messages were loaded. */
  private async load(count: number, append: boolean): Promise<number> {
    const { client } = await this.services.clients.get(this.connection);
    const received = await peek(client, this.source, this.subQueue, count, append ? this.nextSequence : undefined);
    const views = received.map(toView);
    this.messages = append ? this.messages.concat(views) : views;
    const last = received[received.length - 1]?.sequenceNumber;
    if (last) {
      this.nextSequence = last.add(1);
    } else if (!append) {
      this.nextSequence = undefined;
    }
    this.post({ type: 'messages', messages: views, append });
    return views.length;
  }

  private async receiveAndDelete(count: number): Promise<void> {
    if (!this.writable()) {
      return;
    }
    const confirmed = await confirmDestructive({
      message: `Receive and delete up to ${count} message(s) from ${this.label}?`,
      detail: `They will be permanently removed from "${this.connection.name}". This cannot be undone.`,
      action: 'Receive and Delete',
    });
    if (!confirmed) {
      return;
    }
    await this.run('receive', 'Receiving and deleting messages…', async () => {
      const { client } = await this.services.clients.get(this.connection);
      const received = await receiveAndDelete(client, this.source, this.subQueue, count);
      this.services.refreshTree(this.connection.id, resendTarget(this.source));
      // Show what is left, so the table never lists messages that no longer exist.
      // Reload a full page: `count` is how many to delete, not how many rows to show.
      const pageSize = vscode.workspace.getConfiguration('serviceBusWorkbench').get<number>('peekBatchSize', 50);
      const remaining = await this.load(Math.max(pageSize, count), false);
      this.post({
        type: 'status',
        text: `Received and deleted ${received.length} message(s). ${remaining === 0 ? `The ${this.entity} is now empty.` : `Showing ${remaining} message(s) still in the ${this.entity}.`}`,
      });
    });
  }

  /** "queue #12" or "dead-letter #12 of subscription "billing"": where a resent message came from. */
  private origin(sequenceNumber: string | undefined): string {
    const from = 'queue' in this.source ? '' : ` of subscription "${this.source.subscription}"`;
    return `${this.subQueue === 'deadLetter' ? 'dead-letter' : this.entity} #${sequenceNumber ?? '?'}${from}`;
  }

  /** Reports a read-only connection in the panel. Returns whether writing is allowed. */
  private writable(): boolean {
    try {
      assertWritable(this.current);
      return true;
    } catch (err) {
      this.post({ type: 'error', text: err instanceof Error ? err.message : String(err) });
      return false;
    }
  }

  private resend(index: number): void {
    const source = this.messages[index];
    if (!source) {
      return;
    }
    SendPanel.show(this.services, this.extensionUri, {
      connection: this.connection,
      queue: resendTarget(this.source),
      kind: 'resend',
      origin: this.origin(source.sequenceNumber),
      message: toOutgoing(source),
    });
  }

  /** Sends a copy of each selected message. The originals stay where they are. */
  private async resendMany(indexes: number[]): Promise<void> {
    const selected = indexes.map((i) => this.messages[i]).filter((m): m is MessageView => !!m);
    if (selected.length === 0 || !this.writable()) {
      return;
    }
    const target = resendTarget(this.source);
    const confirm = 'Resend';
    const answer = await vscode.window.showWarningMessage(
      `Resend ${selected.length} message(s) to "${target}"?`,
      {
        modal: true,
        detail: `A copy of each message is sent to "${target}" on "${this.connection.name}". The originals stay in ${this.label}.`,
      },
      confirm,
    );
    if (answer !== confirm) {
      return;
    }
    this.post({ type: 'busy', busy: true, text: `Resending ${selected.length} message(s)…` });
    let sent = 0;
    let failure: string | undefined;
    for (const message of selected) {
      try {
        await sendAndRecord(this.services, {
          connection: this.connection,
          queue: target,
          kind: 'resend',
          origin: this.origin(message.sequenceNumber),
          message: toOutgoing(message),
        });
        sent++;
      } catch (err) {
        // Stop at the first failure: the rest would most likely fail the same way.
        failure = err instanceof Error ? err.message : String(err);
        break;
      }
    }
    this.post({ type: 'busy', busy: false });
    if (failure) {
      this.post({ type: 'error', text: `Resent ${sent} of ${selected.length} message(s), then stopped: ${failure}` });
    } else {
      this.post({ type: 'status', text: `Resent ${sent} message(s) to "${target}". Saved to history.` });
    }
  }

  /**
   * Sends dead-lettered messages again and removes them from the dead-letter queue: the ticked
   * ones, or the oldest `count` when none is ticked.
   */
  private async moveBack(count: number, indexes: number[]): Promise<void> {
    if (this.subQueue !== 'deadLetter' || !this.writable()) {
      return;
    }
    const selected = indexes
      .map((i) => this.messages[i]?.sequenceNumber)
      .filter((sequenceNumber): sequenceNumber is string => !!sequenceNumber);
    const target = resendTarget(this.source);
    const where =
      'queue' in this.source ? `the queue "${target}"` : `the topic "${target}", so every subscription of the topic receives them again`;
    const confirmed = await confirmDestructive({
      message:
        selected.length > 0
          ? `Move the ${selected.length} selected message(s) from ${this.label} back to "${target}"?`
          : `Move up to ${count} message(s) from ${this.label} back to "${target}"?`,
      detail: `${selected.length > 0 ? 'Each message' : 'Starting from the oldest, each message'} is sent to ${where}, and then removed from the dead-letter queue. A message that cannot be sent stays in the dead-letter queue.`,
      action: 'Move Back',
    });
    if (!confirmed) {
      return;
    }
    await this.run('receive', 'Moving messages back…', async () => {
      const { client } = await this.services.clients.get(this.connection);
      let failure: string | undefined;
      const forward = async (received: ServiceBusReceivedMessage) => {
        const view = toView(received);
        try {
          await sendAndRecord(this.services, {
            connection: this.connection,
            queue: target,
            kind: 'resend',
            origin: `${this.origin(view.sequenceNumber)}, moved back`,
            message: toOutgoing(view),
          });
        } catch (err) {
          // sendAndRecord already produced the text for the user.
          failure = err instanceof Error ? err.message : String(err);
          throw err;
        }
      };
      const result =
        selected.length > 0
          ? await moveSelectedFromDeadLetter(client, this.source, selected, forward)
          : { ...(await moveFromDeadLetter(client, this.source, count, forward)), missing: 0 };
      this.services.refreshTree(this.connection.id, resendTarget(this.source));
      const pageSize = vscode.workspace.getConfiguration('serviceBusWorkbench').get<number>('peekBatchSize', 50);
      const remaining = await this.load(pageSize, false);
      if (result.error) {
        this.post({
          type: 'error',
          text: `Moved ${result.moved} message(s), then stopped: ${failure ?? describeError(result.error, 'receive')}`,
        });
        return;
      }
      const missing = result.missing > 0 ? ` ${result.missing} selected message(s) were no longer in the dead-letter queue.` : '';
      this.post({
        type: 'status',
        text: `Moved ${result.moved} message(s) back to "${target}".${missing} ${remaining === 0 ? 'The dead-letter queue is now empty.' : `Showing ${remaining} message(s) still in the dead-letter queue.`}`,
      });
    });
  }

  private async run(operation: 'peek' | 'receive', label: string, action: () => Promise<void>): Promise<void> {
    this.post({ type: 'busy', busy: true, text: label });
    try {
      await action();
    } catch (err) {
      this.post({ type: 'error', text: describeError(err, operation) });
    } finally {
      this.post({ type: 'busy', busy: false });
    }
  }

  private post(message: unknown): void {
    void this.panel.webview.postMessage(message);
  }
}
