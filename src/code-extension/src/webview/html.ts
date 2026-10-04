import * as vscode from 'vscode';
import { randomBytes } from 'crypto';
import { ConnectionConfig } from '../types';

/** Placeholder for the read-only notice. media/banner.js fills it in. */
export const BANNER = '<div id="banner" class="banner hidden"></div>';

/** The protection state a webview needs to draw the banner and hide what read-only mode forbids. */
export function protectionOf(connection: ConnectionConfig): { readOnly: boolean } {
  return { readOnly: !!connection.readOnly };
}

/** Wraps a static body in a page that loads media/style.css, the shared banner script and one panel script under a strict CSP. */
export function renderHtml(webview: vscode.Webview, extensionUri: vscode.Uri, script: string, body: string): string {
  const nonce = randomBytes(16).toString('base64');
  const media = (file: string) => webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', file));
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${media('style.css')}">
</head>
<body>
${body}
<script nonce="${nonce}" src="${media('banner.js')}"></script>
<script nonce="${nonce}" src="${media(script)}"></script>
</body>
</html>`;
}

export function webviewOptions(extensionUri: vscode.Uri): vscode.WebviewOptions & vscode.WebviewPanelOptions {
  return {
    enableScripts: true,
    retainContextWhenHidden: true,
    localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
  };
}
