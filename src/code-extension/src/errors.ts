export type Operation = 'list' | 'peek' | 'receive' | 'send';

const PERMISSION_HINT: Record<Operation, string> = {
  list: "Not authorized to list queues. With Entra ID you need the 'Azure Service Bus Data Owner' role; a connection string needs the Manage claim.",
  peek: "Not authorized to read messages. With Entra ID you need the 'Azure Service Bus Data Receiver' role; a connection string needs the Listen claim.",
  receive:
    "Not authorized to receive messages. With Entra ID you need the 'Azure Service Bus Data Receiver' role; a connection string needs the Listen claim.",
  send: "Not authorized to send messages. With Entra ID you need the 'Azure Service Bus Data Sender' role; a connection string needs the Send claim.",
};

const UNREACHABLE_CODES = new Set(['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'ServiceCommunicationProblem']);

/** Turns SDK errors into a message that tells the user what to fix. */
export function describeError(err: unknown, operation: Operation): string {
  const e = (err ?? {}) as { code?: string; statusCode?: number; message?: string };
  const message = firstLine(e.message ?? String(err));
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
