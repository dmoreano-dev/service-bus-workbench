export type Operation = 'list' | 'peek' | 'receive' | 'send';

const PERMISSION_HINT: Record<Operation, string> = {
  list: "Not authorized to list queues. With Entra ID you need the 'Azure Service Bus Data Owner' role; a connection string needs the Manage claim.",
  peek: "Not authorized to read messages. With Entra ID you need the 'Azure Service Bus Data Receiver' role, even if you are Owner of the namespace; a connection string needs the Listen claim.",
  receive:
    "Not authorized to receive messages. With Entra ID you need the 'Azure Service Bus Data Receiver' role, even if you are Owner of the namespace; a connection string needs the Listen claim.",
  send: "Not authorized to send messages. With Entra ID you need the 'Azure Service Bus Data Sender' role, even if you are Owner of the namespace; a connection string needs the Send claim.",
};

const UNREACHABLE_CODES = new Set(['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'ServiceCommunicationProblem']);

/** Turns SDK errors into a message that tells the user what to fix. */
export function describeError(err: unknown, operation: Operation): string {
  // When its retries run out the SDK throws an AggregateError with an empty message; the last
  // attempt's error is the one that explains the failure.
  const attempts = (err as { errors?: unknown } | undefined)?.errors;
  if (Array.isArray(attempts) && attempts.length > 0) {
    return describeError(attempts[attempts.length - 1], operation);
  }
  const e = (err ?? {}) as { code?: string; statusCode?: number; message?: string; name?: string };
  // Never return an empty text: the panel would show nothing and the failure would go unnoticed.
  const message = firstLine(e.message ?? String(err)) || `Unexpected error (${e.code ?? e.name ?? 'unknown'}).`;
  if (e.code === 'UnauthorizedAccess' || e.statusCode === 401 || e.statusCode === 403) {
    return `${PERMISSION_HINT[operation]} (${message})`;
  }
  if (e.code && UNREACHABLE_CODES.has(e.code)) {
    return `Cannot reach the namespace. Check the host name and your network; if port 5671 is blocked, enable "Service Bus Workbench: Use Web Sockets". (${message})`;
  }
  return message;
}

function firstLine(text: string): string {
  return text.split('\n')[0].trim();
}
