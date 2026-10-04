import * as fs from 'fs';
import * as vscode from 'vscode';
import { addConnection } from './commands/addConnection';
import { ConnectionStore } from './connections/connectionStore';
import { HistoryStore } from './history/historyStore';
import { MessagesPanel } from './panels/messagesPanel';
import { SendPanel } from './panels/sendPanel';
import { ClientFactory } from './serviceBus/clientFactory';
import { sendAndRecord, Services } from './services';
import { ConnectionProtection, SubQueue } from './types';
import {
  ConnectionNode,
  ConnectionsTreeProvider,
  QueueNode,
  SubQueueNode,
  SubscriptionNode,
  TopicNode,
} from './views/connectionsTree';
import { HistoryGrouping, HistoryNode, HistoryTreeProvider } from './views/historyTree';

let clients: ClientFactory | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const connections = new ConnectionStore(context);
  const history = new HistoryStore(context.globalStorageUri);
  clients = new ClientFactory(connections);
  const factory = clients;

  // A bulk resend or a move sends many messages in a row; reload the tree once they settle.
  let refreshTimer: NodeJS.Timeout | undefined;
  const refreshTree = () => {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => tree.refresh(), 300);
  };
  const services: Services = { connections, clients: factory, history, refreshTree };
  const tree = new ConnectionsTreeProvider(services);
  const historyTree = new HistoryTreeProvider(history);

  if (context.extensionMode === vscode.ExtensionMode.Development) {
    reloadOnRebuild(context);
  }

  type MessagesNode = QueueNode | SubscriptionNode | SubQueueNode;
  const openMessages = (node: MessagesNode, subQueue: SubQueue) =>
    MessagesPanel.show(services, context.extensionUri, node.connection, node.source, subQueue);

  const historyView = vscode.window.createTreeView('sbw.history', { treeDataProvider: historyTree });
  const showHistoryFilter = async () => {
    const filter = historyTree.filter;
    void vscode.commands.executeCommand('setContext', 'sbw.history.filtered', filter !== '');
    if (!filter) {
      historyView.message = undefined;
      return;
    }
    const { shown, total } = await historyTree.counts();
    historyView.message = `Filter: "${filter}" · ${shown} of ${total}`;
  };
  const protect = (protection: ConnectionProtection) => (node: ConnectionNode) =>
    connections.update(node.connection.id, protection);

  const resolveHistory = async (node: HistoryNode) => {
    const connection = connections.get(node.entry.connectionId);
    if (!connection) {
      void vscode.window.showErrorMessage(
        `The connection "${node.entry.connectionName}" used for this message no longer exists.`,
      );
      return undefined;
    }
    return { connection, queue: node.entry.queue, message: node.entry.message, kind: 'resend' as const, origin: 'history' };
  };

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('sbw.connections', tree),
    historyView,
    history.onDidChange(() => void showHistoryFilter()),
    connections.onDidChange(() => tree.refresh()),

    vscode.commands.registerCommand('sbw.addConnection', () => addConnection(connections, factory)),
    vscode.commands.registerCommand('sbw.refresh', () => tree.refresh()),
    vscode.commands.registerCommand('sbw.removeConnection', async (node: ConnectionNode) => {
      const confirm = 'Remove';
      const answer = await vscode.window.showWarningMessage(
        `Remove the connection "${node.connection.name}"?`,
        { modal: true, detail: 'Only the saved connection is removed. Nothing changes in Azure.' },
        confirm,
      );
      if (answer === confirm) {
        await factory.dispose(node.connection.id);
        await connections.remove(node.connection.id);
      }
    }),
    vscode.commands.registerCommand('sbw.enableReadOnly', protect({ readOnly: true })),
    vscode.commands.registerCommand('sbw.disableReadOnly', protect({ readOnly: false })),
    vscode.commands.registerCommand('sbw.openMessages', (node: MessagesNode) => openMessages(node, 'active')),
    vscode.commands.registerCommand('sbw.openDeadLetter', (node: MessagesNode) => openMessages(node, 'deadLetter')),
    vscode.commands.registerCommand('sbw.sendMessage', (node: QueueNode | TopicNode) =>
      SendPanel.show(services, context.extensionUri, {
        connection: node.connection,
        queue: node.sendTarget,
        kind: 'send',
        message: { body: '', contentType: 'application/json' },
      }),
    ),

    vscode.commands.registerCommand('sbw.history.open', async (node: HistoryNode) => {
      const request = await resolveHistory(node);
      if (request) {
        SendPanel.show(services, context.extensionUri, request);
      }
    }),
    vscode.commands.registerCommand('sbw.history.resend', async (node: HistoryNode) => {
      const request = await resolveHistory(node);
      if (!request) {
        return;
      }
      const confirm = 'Send Again';
      const answer = await vscode.window.showInformationMessage(
        `Send this message again to "${request.queue}" on ${request.connection.name}?`,
        { modal: true },
        confirm,
      );
      if (answer !== confirm) {
        return;
      }
      try {
        await sendAndRecord(services, request);
        void vscode.window.showInformationMessage(`Message sent to "${request.queue}".`);
      } catch (err) {
        void vscode.window.showErrorMessage(err instanceof Error ? err.message : String(err));
      }
    }),
    vscode.commands.registerCommand('sbw.history.search', async () => {
      const query = await vscode.window.showInputBox({
        title: 'Search sent history',
        prompt: 'Matches the queue or topic, connection, subject, IDs, properties and body. Leave empty to show everything.',
        value: historyTree.filter,
      });
      if (query !== undefined) {
        historyTree.setFilter(query);
        await showHistoryFilter();
      }
    }),
    vscode.commands.registerCommand('sbw.history.clearSearch', async () => {
      historyTree.setFilter('');
      await showHistoryFilter();
    }),
    vscode.commands.registerCommand('sbw.history.groupBy', async () => {
      const config = vscode.workspace.getConfiguration('serviceBusWorkbench.history');
      const current = config.get<HistoryGrouping>('groupBy', 'none');
      const options: (vscode.QuickPickItem & { grouping: HistoryGrouping })[] = [
        { grouping: 'none', label: 'No grouping', detail: 'One list, newest first' },
        { grouping: 'queue', label: 'By queue or topic', detail: 'One group per destination and connection' },
        { grouping: 'day', label: 'By day', detail: 'One group per day' },
      ];
      const picked = await vscode.window.showQuickPick(
        options.map((o) => ({ ...o, description: o.grouping === current ? 'current' : undefined })),
        { title: 'Group sent history' },
      );
      if (picked) {
        await config.update('groupBy', picked.grouping, vscode.ConfigurationTarget.Global);
      }
    }),
    vscode.commands.registerCommand('sbw.history.delete', (node: HistoryNode) => history.remove(node.entry.id)),
    vscode.commands.registerCommand('sbw.history.clear', async () => {
      const confirm = 'Clear History';
      const answer = await vscode.window.showWarningMessage(
        'Delete the entire sent history?',
        { modal: true, detail: 'This only removes the local record. Messages already sent are not affected.' },
        confirm,
      );
      if (answer === confirm) {
        await history.clear();
      }
    }),

    vscode.workspace.onDidChangeConfiguration(async (e) => {
      if (e.affectsConfiguration('serviceBusWorkbench.useWebSockets')) {
        // Transport is fixed when a client is created, so drop the cached clients.
        await factory.dispose();
        tree.refresh();
      }
      if (e.affectsConfiguration('serviceBusWorkbench.history.groupBy')) {
        historyTree.refresh();
      }
    }),
    { dispose: () => clearTimeout(refreshTimer) },
  );
}

/** In development, reloads the window when the watch build rewrites the bundle or a webview asset changes. */
function reloadOnRebuild(context: vscode.ExtensionContext): void {
  let timer: NodeJS.Timeout | undefined;
  const reload = () => {
    clearTimeout(timer);
    timer = setTimeout(() => void vscode.commands.executeCommand('workbench.action.reloadWindow'), 500);
  };
  const dir = (name: string) => vscode.Uri.joinPath(context.extensionUri, name).fsPath;
  const watchers = [
    fs.watch(dir('dist'), (_event, file) => file === 'extension.js' && reload()),
    fs.watch(dir('media'), reload),
  ];
  context.subscriptions.push({ dispose: () => watchers.forEach((w) => w.close()) });
}

export async function deactivate(): Promise<void> {
  await clients?.dispose();
}
