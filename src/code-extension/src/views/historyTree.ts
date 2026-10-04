import * as vscode from 'vscode';
import { groupEntries, matchesQuery } from '../history/historyQuery';
import { HistoryStore } from '../history/historyStore';
import { HistoryEntry } from '../types';

export class HistoryNode extends vscode.TreeItem {
  constructor(readonly entry: HistoryEntry) {
    super(entry.queue, vscode.TreeItemCollapsibleState.None);
    this.id = entry.id;
    this.contextValue = 'historyEntry';
    const when = new Date(entry.timestamp).toLocaleString();
    const summary = entry.message.subject || entry.message.messageId || preview(entry.message.body);
    this.description = `${when} · ${summary}`;
    this.iconPath =
      entry.status === 'error'
        ? new vscode.ThemeIcon('error', new vscode.ThemeColor('errorForeground'))
        : new vscode.ThemeIcon(entry.kind === 'resend' ? 'reply' : 'arrow-up');
    this.tooltip = tooltip(entry, when);
    this.command = { command: 'sbw.history.open', title: 'Edit and Send Again', arguments: [this] };
  }
}

function preview(body: string): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  return flat.length > 60 ? `${flat.slice(0, 60)}…` : flat;
}

function tooltip(entry: HistoryEntry, when: string): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.appendMarkdown(`**${entry.kind === 'resend' ? 'Resent' : 'Sent'}** to \`${entry.queue}\` on ${entry.connectionName}\n\n`);
  md.appendMarkdown(`${when}${entry.origin ? ` · from ${entry.origin}` : ''}\n\n`);
  if (entry.status === 'error') {
    md.appendMarkdown('**Failed:** ');
    md.appendText(entry.error ?? 'unknown error');
    md.appendMarkdown('\n\n');
  }
  md.appendCodeblock(entry.message.body.slice(0, 1000));
  return md;
}

export type HistoryGrouping = 'none' | 'queue' | 'day';

export class HistoryGroupNode extends vscode.TreeItem {
  constructor(
    label: string,
    readonly entries: HistoryEntry[],
    icon: string,
  ) {
    super(label, vscode.TreeItemCollapsibleState.Expanded);
    this.description = String(entries.length);
    this.iconPath = new vscode.ThemeIcon(icon);
  }
}

type Node = HistoryNode | HistoryGroupNode;

const dayOf = (entry: HistoryEntry) =>
  new Date(entry.timestamp).toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });

export class HistoryTreeProvider implements vscode.TreeDataProvider<Node> {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;
  private query = '';

  constructor(private readonly history: HistoryStore) {
    history.onDidChange(() => this.emitter.fire());
  }

  /** The text entries must contain to be listed. Empty when nothing is filtered. */
  get filter(): string {
    return this.query;
  }

  setFilter(query: string): void {
    this.query = query.trim();
    this.emitter.fire();
  }

  refresh(): void {
    this.emitter.fire();
  }

  /** How many entries pass the filter, out of how many. */
  async counts(): Promise<{ shown: number; total: number }> {
    const entries = await this.history.list();
    return { shown: entries.filter((e) => matchesQuery(e, this.query)).length, total: entries.length };
  }

  getTreeItem(node: Node): vscode.TreeItem {
    return node;
  }

  async getChildren(node?: Node): Promise<Node[]> {
    if (node instanceof HistoryGroupNode) {
      return node.entries.map((e) => new HistoryNode(e));
    }
    if (node) {
      return [];
    }
    const entries = (await this.history.list()).filter((e) => matchesQuery(e, this.query));
    const grouping = vscode.workspace.getConfiguration('serviceBusWorkbench.history').get<HistoryGrouping>('groupBy', 'none');
    if (grouping === 'queue') {
      return groupEntries(entries, (e) => `${e.queue} · ${e.connectionName}`).map(
        (g) => new HistoryGroupNode(g.label, g.entries, 'inbox'),
      );
    }
    if (grouping === 'day') {
      // Entries are stored newest first, so the days come out in that order too.
      return groupEntries(entries, dayOf).map((g) => new HistoryGroupNode(g.label, g.entries, 'calendar'));
    }
    return entries.map((e) => new HistoryNode(e));
  }
}
