import * as vscode from 'vscode';
import { describeError } from '../errors';
import { peek, receiveAndDelete, SequenceNumber, toView } from '../serviceBus/operations';
import { Services } from '../services';
import { ConnectionConfig, MessageView, SubQueue } from '../types';
import { renderHtml, webviewOptions } from '../webview/html';
import { SendPanel } from './sendPanel';

type FromWebview =
  | { type: 'ready' }
  | { type: 'peek'; count: number }
  | { type: 'more'; count: number }
  | { type: 'receiveDelete'; count: number }
  | { type: 'resend'; index: number };

const BODY = `
<div class="toolbar">
  <label>Count <input id="count" type="number" min="1" max="500"></label>
  <button id="peek">Peek</button>
  <button id="more" class="secondary">Load more</button>
  <span class="spacer"></span>
  <button id="receiveDelete" class="danger">Receive and delete…</button>
</div>
<div id="status" class="status"></div>
<div class="table-wrap">
  <div id="loading" class="loading hidden"><div class="spinner"></div><span id="loadingText"></span></div>
  <table>
    <thead><tr><th>Seq</th><th>Enqueued</th><th>Message ID</th><th>Subject</th><th>Deliveries</th><th>Body</th></tr></thead>
    <tbody id="rows"></tbody>
  </table>
</div>
<div id="details" class="details hidden">
  <div class="toolbar">
    <strong id="detailsTitle"></strong>
    <span class="spacer"></span>
    <button id="resend" class="secondary">Resend…</button>
  </div>
  <dl id="props"></dl>
  <pre id="body"></pre>
</div>`;

/** One webview per queue/sub-queue showing peeked (or just-received) messages. */
export class MessagesPanel {
  private static readonly open = new Map<string, MessagesPanel>();

  static show(
    services: Services,
    extensionUri: vscode.Uri,
    connection: ConnectionConfig,
    queue: string,
    subQueue: SubQueue,
  ): void {
    const key = `${connection.id}/${queue}/${subQueue}`;
    const existing = MessagesPanel.open.get(key);
    if (existing) {
      existing.panel.reveal();
      return;
    }
    MessagesPanel.open.set(key, new MessagesPanel(key, services, extensionUri, connection, queue, subQueue));
  }

  private readonly panel: vscode.WebviewPanel;
  private messages: MessageView[] = [];
  private nextSequence: SequenceNumber | undefined;

  private constructor(
    key: string,
    private readonly services: Services,
    private readonly extensionUri: vscode.Uri,
    private readonly connection: ConnectionConfig,
    private readonly queue: string,
    private readonly subQueue: SubQueue,
  ) {
    const title = subQueue === 'deadLetter' ? `${queue} (dead-letter)` : queue;
    this.panel = vscode.window.createWebviewPanel('sbw.messages', title, vscode.ViewColumn.Active, webviewOptions(extensionUri));
    this.panel.webview.html = renderHtml(this.panel.webview, extensionUri, 'messages.js', BODY);
    this.panel.onDidDispose(() => MessagesPanel.open.delete(key));
    this.panel.webview.onDidReceiveMessage((m: FromWebview) => this.handle(m));
  }

  private get label(): string {
    return this.subQueue === 'deadLetter' ? `the dead-letter queue of "${this.queue}"` : `"${this.queue}"`;
  }

  private async handle(message: FromWebview): Promise<void> {
    switch (message.type) {
      case 'ready': {
        const count = vscode.workspace.getConfiguration('serviceBusWorkbench').get<number>('peekBatchSize', 50);
        this.post({ type: 'init', count });
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

  /** Peeks into the queue and shows the result. Returns how many messages were loaded. */
  private async load(count: number, append: boolean): Promise<number> {
    const { client } = await this.services.clients.get(this.connection);
    const received = await peek(client, this.queue, this.subQueue, count, append ? this.nextSequence : undefined);
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
    const confirm = 'Receive and Delete';
    const answer = await vscode.window.showWarningMessage(
      `Receive and delete up to ${count} message(s) from ${this.label}?`,
      { modal: true, detail: `They will be permanently removed from "${this.connection.name}". This cannot be undone.` },
      confirm,
    );
    if (answer !== confirm) {
      return;
    }
    await this.run('receive', 'Receiving and deleting messages…', async () => {
      const { client } = await this.services.clients.get(this.connection);
      const received = await receiveAndDelete(client, this.queue, this.subQueue, count);
      this.services.refreshTree();
      // Show what is left in the queue, so the table never lists messages that no longer exist.
      // Reload a full page: `count` is how many to delete, not how many rows to show.
      const pageSize = vscode.workspace.getConfiguration('serviceBusWorkbench').get<number>('peekBatchSize', 50);
      const remaining = await this.load(Math.max(pageSize, count), false);
      this.post({
        type: 'status',
        text: `Received and deleted ${received.length} message(s). ${remaining === 0 ? 'The queue is now empty.' : `Showing ${remaining} message(s) still in the queue.`}`,
      });
    });
  }

  private resend(index: number): void {
    const source = this.messages[index];
    if (!source) {
      return;
    }
    const applicationProperties: Record<string, string | number | boolean> = {};
    for (const [key, value] of Object.entries(source.applicationProperties)) {
      // Service Bus adds these when it dead-letters a message; a resent copy must not carry them.
      if (key === 'DeadLetterReason' || key === 'DeadLetterErrorDescription') {
        continue;
      }
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        applicationProperties[key] = value;
      }
    }
    SendPanel.show(this.services, this.extensionUri, {
      connection: this.connection,
      queue: this.queue,
      kind: 'resend',
      origin: `${this.subQueue === 'deadLetter' ? 'dead-letter' : 'queue'} #${source.sequenceNumber ?? '?'}`,
      message: {
        body: source.body,
        contentType: source.contentType,
        subject: source.subject,
        messageId: source.messageId,
        correlationId: source.correlationId,
        sessionId: source.sessionId,
        applicationProperties,
      },
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
