import * as vscode from 'vscode';
import { randomUUID } from 'crypto';
import { HistoryEntry } from '../types';

/**
 * Sent/resent messages, newest first, stored as a JSON file in the extension's global storage.
 * Message bodies can be sensitive, so history never leaves this machine.
 */
export class HistoryStore {
  private entries: HistoryEntry[] | undefined;
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;

  constructor(private readonly storageUri: vscode.Uri) {}

  private get file(): vscode.Uri {
    return vscode.Uri.joinPath(this.storageUri, 'history.json');
  }

  async list(): Promise<HistoryEntry[]> {
    if (!this.entries) {
      try {
        const raw = await vscode.workspace.fs.readFile(this.file);
        this.entries = JSON.parse(Buffer.from(raw).toString('utf8')) as HistoryEntry[];
      } catch {
        this.entries = [];
      }
    }
    return this.entries;
  }

  async get(id: string): Promise<HistoryEntry | undefined> {
    return (await this.list()).find((e) => e.id === id);
  }

  async add(entry: Omit<HistoryEntry, 'id' | 'timestamp'>): Promise<void> {
    const config = vscode.workspace.getConfiguration('serviceBusWorkbench.history');
    if (!config.get<boolean>('enabled', true)) {
      return;
    }
    const max = Math.max(1, config.get<number>('maxEntries', 500));
    const entries = await this.list();
    entries.unshift({ ...entry, id: randomUUID(), timestamp: new Date().toISOString() });
    entries.length = Math.min(entries.length, max);
    await this.save();
  }

  async remove(id: string): Promise<void> {
    this.entries = (await this.list()).filter((e) => e.id !== id);
    await this.save();
  }

  async clear(): Promise<void> {
    this.entries = [];
    await this.save();
  }

  private async save(): Promise<void> {
    await vscode.workspace.fs.createDirectory(this.storageUri);
    await vscode.workspace.fs.writeFile(this.file, Buffer.from(JSON.stringify(this.entries ?? []), 'utf8'));
    this.emitter.fire();
  }
}
