export type Operation = 'list' | 'peek' | 'receive' | 'send';

const PERMISSION_HINT: Record<Operation, string> = {
  list: "Not authorized to list queues and topics. With Entra ID you need the 'Azure Service Bus Data Owner' role; a connection string needs the Manage claim.",
  peek: "Not authorized to read messages. With Entra ID you need the 'Azure Service Bus Data Receiver' role, even if you are Owner of the namespace; a connection string needs the Listen claim.",
  receive:
    "Not authorized to receive messages. With Entra ID you need the 'Azure Service Bus Data Receiver' role, even if you are Owner of the namespace; a connection string needs the Listen claim.",
  send: "Not authorized to send messages. With Entra ID you need the 'Azure Service Bus Data Sender' role, even if you are Owner of the namespace; a connection string needs the Send claim.",
};

/**
 * Service Bus answers 401 both for a key that lacks a claim and for a key that is simply wrong.
 * The sub-code tells them apart: 40103 is an invalid signature, 40101 an unknown key name.
 */
const INVALID_KEY = /\b4010[13]\b|invalid (authorization token )?signature|InvalidSignature/i;

const UNREACHABLE_CODES = new Set(['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'ServiceCommunicationProblem']);

/**
 * When its retries run out the SDK throws an AggregateError with an empty message; the last
 * attempt's error is the one that explains the failure.
 */
function lastAttempt(err: unknown): unknown {
  const attempts = (err as { errors?: unknown } | undefined)?.errors;
  return Array.isArray(attempts) && attempts.length > 0 ? lastAttempt(attempts[attempts.length - 1]) : err;
}

/** True when the error means the credential lacks a role or claim, rather than a network or usage problem. */
export function isUnauthorized(err: unknown): boolean {
  const e = (lastAttempt(err) ?? {}) as { code?: string; statusCode?: number };
  return e.code === 'UnauthorizedAccess' || e.statusCode === 401 || e.statusCode === 403;
}

/** True when a connection string was refused because its key or key name is wrong. Waiting or assigning claims will not fix it. */
export function isInvalidKey(err: unknown): boolean {
  const e = (lastAttempt(err) ?? {}) as { message?: string };
  return isUnauthorized(err) && INVALID_KEY.test(e.message ?? '');
}

/** Turns SDK errors into a message that tells the user what to fix. */
export function describeError(error: unknown, operation: Operation): string {
  const err = lastAttempt(error);
  const e = (err ?? {}) as { code?: string; statusCode?: number; message?: string; name?: string };
  // Never return an empty text: the panel would show nothing and the failure would go unnoticed.
  const message = firstLine(e.message ?? String(err)) || `Unexpected error (${e.code ?? e.name ?? 'unknown'}).`;
  if (isInvalidKey(err)) {
    return `The key or key name of the connection string is not valid. Check that it was copied in full. (${message})`;
  }
  if (isUnauthorized(err)) {
    return `${PERMISSION_HINT[operation]} (${message})`;
  }
  if (e.code && UNREACHABLE_CODES.has(e.code)) {
    return `Cannot reach the namespace. Check the host name and your network; if port 5671 is blocked, enable "Service Bus Workbench: Use Web Sockets". (${message})`;
  }
  return message;
}

/** The first line of an SDK message, without the tracking data Service Bus appends: it is noise in a dialog. */
function firstLine(text: string): string {
  return text
    .split('\n')[0]
    .replace(/[\s,]*\b(TrackingId|SystemTracker|Timestamp):.*$/, '')
    .trim();
}
