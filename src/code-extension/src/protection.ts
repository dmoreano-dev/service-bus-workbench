import * as vscode from 'vscode';
import { ConnectionConfig } from './types';

/** Throws when the connection is in read-only mode. Call it before anything that sends or removes messages. */
export function assertWritable(connection: ConnectionConfig): void {
  if (connection.readOnly) {
    throw new Error(
      `"${connection.name}" is in read-only mode. Disable it from the connection's context menu to send, receive or move messages.`,
    );
  }
}

export interface DestructiveAction {
  message: string;
  detail: string;
  /** Label of the button that confirms, e.g. "Receive and Delete". */
  action: string;
}

/** Asks for confirmation in a modal dialog before an operation that removes messages. */
export async function confirmDestructive(options: DestructiveAction): Promise<boolean> {
  const answer = await vscode.window.showWarningMessage(options.message, { modal: true, detail: options.detail }, options.action);
  return answer === options.action;
}
