import * as vscode from 'vscode';
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

export class HistoryTreeProvider implements vscode.TreeDataProvider<HistoryNode> {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;

  constructor(private readonly history: HistoryStore) {
    history.onDidChange(() => this.emitter.fire());
  }

  getTreeItem(node: HistoryNode): vscode.TreeItem {
    return node;
  }

  async getChildren(node?: HistoryNode): Promise<HistoryNode[]> {
    if (node) {
      return [];
    }
    return (await this.history.list()).map((e) => new HistoryNode(e));
  }
}
