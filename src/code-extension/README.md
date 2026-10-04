# Service Bus Workbench

Explore Azure Service Bus queues, topics and subscriptions from VS Code: peek and receive messages, send and resend them, and keep a history of everything you sent.

Found a problem? Please [report it](https://github.com/dmoreano-dev/service-bus-workbench/issues).

## Features

- **Connections** with a connection string (for a namespace or a single queue), with Microsoft Entra ID using the Microsoft account signed in to VS Code or your Azure CLI sign-in, or to the local emulator with one click.
- **Queues, topics and subscriptions** in one tree, with active and dead-letter message counts.
- **Peek** a queue or subscription and its dead-letter queue, with paging ("Load more") and the full body, properties and dead-letter reason of each message.
- **Receive and delete**, always behind an explicit confirmation.
- **Send** messages with content type, subject, message ID, correlation ID, session ID and application properties.
- **Resend** a message you are looking at, for example from the dead-letter queue, editing it first if you need to. Tick several rows to resend them in one go.
- **Move back** dead-lettered messages, the ones you tick or the oldest ones up to the count: each one is sent again to its queue or topic and removed from the dead-letter queue only once the send succeeds.
- **Read-only mode** for a connection, so nothing can be sent to it or removed from it by mistake.
- **Sent history** of every send and resend, including the failed ones, with "Edit and Send Again" and "Send Again As-is". Search it, and group it by queue or by day.

## Getting started

1. Open the **Service Bus Workbench** view in the activity bar.
2. Select **Add Connection** and pick how to connect:
   - **Connection string**: a namespace-level or queue-level shared access (SAS) connection string.
   - **Microsoft Entra ID**: browse your subscriptions, or enter the namespace host name. Either with the Microsoft account signed in to VS Code, or with **Azure CLI or environment credentials** (`DefaultAzureCredential`: `az login`, `azd`, environment variables, managed identity).
   - **Local emulator**: the Service Bus emulator on `localhost` with its default ports (5672 and 5300). Listing queues and topics needs emulator 2.0 or later. For an emulator on another host or port, use **Connection string** with its own connection string (`UseDevelopmentEmulator=true`); you are asked for the management port.
3. Expand the connection, then a queue or a subscription of a topic, and select **Messages** or **Dead-letter**.

## Read-only mode

Right-click a connection and select **Enable Read-only Mode** to hide and refuse everything that sends or removes messages on it: send, resend, receive and delete, and move back. Peeking still works. The mode is local to your VS Code; nothing changes in Azure.

## Permissions

| To | Entra ID (RBAC role) | Connection string (claim) |
|---|---|---|
| List queues, topics and subscriptions, and see counts | Azure Service Bus Data Owner, or Owner of the namespace. Reader is enough for connections added with "browse my subscriptions" | Manage |
| Peek / receive | Azure Service Bus Data Receiver | Listen |
| Send | Azure Service Bus Data Sender | Send |

Being Owner or Reader of the namespace is enough to list its entities, but it does not give access to messages: peeking, receiving and sending require the data roles.

A connection string for a single queue (with `EntityPath`) works without the Manage claim: that queue is shown, without counts.

## Settings

| Setting | Default | Description |
|---|---|---|
| `serviceBusWorkbench.peekBatchSize` | 50 | Messages to peek or receive at a time |
| `serviceBusWorkbench.useWebSockets` | false | Use AMQP over WebSockets (port 443) when a firewall blocks port 5671 |
| `serviceBusWorkbench.history.enabled` | true | Record sends and resends in the Sent History view |
| `serviceBusWorkbench.history.maxEntries` | 500 | Maximum number of history entries |
| `serviceBusWorkbench.history.groupBy` | none | Group the Sent History view by `queue` or by `day` |

## Where your data is stored

- Connection strings are kept in VS Code secret storage, never in `settings.json`.
- The sent history is a `history.json` file in the extension's global storage, on your machine only. It contains message bodies: if you send sensitive data, turn the history off or clear it.

## Known limitations

- On session-enabled queues and subscriptions, peek and send work (set a Session ID), but receive and delete and move back do not.
- A message read from a subscription is resent or moved back to its topic, so every subscription of that topic receives it again.
- A connection string for a single entity (with `EntityPath`) is treated as a queue.
- Listing through Azure Resource Manager with the Reader role only works for connections added with "browse my subscriptions" from this version on.
- A resend keeps the body, properties and IDs; it does not keep the time to live or the scheduled time.
- With the emulator, counts are obtained by peeking and are shown as `100+` from 100 messages.

## License

[MIT](https://github.com/dmoreano-dev/service-bus-workbench/blob/main/LICENSE)
