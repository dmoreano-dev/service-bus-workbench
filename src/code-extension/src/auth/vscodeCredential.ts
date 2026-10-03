import * as vscode from 'vscode';
import type { AccessToken, TokenCredential } from '@azure/core-auth';

/** Azure SDK credential backed by VS Code's built-in Microsoft account sign-in. */
export class VSCodeCredential implements TokenCredential {
  constructor(private readonly tenantId?: string) {}

  async getToken(scopes: string | string[]): Promise<AccessToken> {
    const requested = Array.isArray(scopes) ? [...scopes] : [scopes];
    if (this.tenantId) {
      requested.push(`VSCODE_TENANT:${this.tenantId}`);
    }
    const session = await vscode.authentication.getSession('microsoft', requested, { createIfNone: true });
    return { token: session.accessToken, expiresOnTimestamp: expiryOf(session.accessToken) };
  }
}

/** VS Code sessions don't expose expiry, so read it from the JWT; fall back to a short lifetime. */
function expiryOf(jwt: string): number {
  try {
    const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8')) as { exp?: number };
    if (typeof payload.exp === 'number') {
      return payload.exp * 1000;
    }
  } catch {
    // not a JWT we can read
  }
  return Date.now() + 5 * 60_000;
}
