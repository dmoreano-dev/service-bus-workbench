# Service Bus Workbench

Explore Azure Service Bus queues from VS Code: peek and receive messages, send and resend them, and keep a history of everything you sent.

> **Preview.** Everything below has been tested against the local Service Bus emulator. Connecting with Microsoft Entra ID, RBAC permission hints and AMQP over WebSockets have not been verified against a real Azure namespace yet. Please [report any problem](https://github.com/dmoreano-dev/service-bus-workbench/issues).

## Features

- **Connections** with a connection string (for a namespace or a single queue), with Microsoft Entra ID using the Microsoft account signed in to VS Code, or to the local emulator with one click.
- **Queue tree** with active and dead-letter message counts.
- **Peek** a queue and its dead-letter queue, with paging ("Load more") and the full body, properties and dead-letter reason of each message.
- **Receive and delete**, always behind an explicit confirmation.
- **Send** messages with content type, subject, message ID, correlation ID, session ID and application properties.
- **Resend** a message you are looking at, for example from the dead-letter queue, editing it first if you need to.
- **Sent history** of every send and resend, including the failed ones, with "Edit and Send Again" and "Send Again As-is".

## Getting started

1. Open the **Service Bus Workbench** view in the activity bar.
2. Select **Add Connection** and pick how to connect:
   - **Connection string**: a namespace-level or queue-level shared access (SAS) connection string.
   - **Microsoft Entra ID**: browse your subscriptions, or enter the namespace host name.
   - **Local emulator**: the Service Bus emulator on `localhost` with its default ports (5672 and 5300). Listing queues needs emulator 2.0 or later.
3. Expand the connection, then a queue, and select **Messages** or **Dead-letter**.

## Permissions

| To | Entra ID (RBAC role) | Connection string (claim) |
|---|---|---|
| List queues and see counts | Azure Service Bus Data Owner | Manage |
| Peek / receive | Azure Service Bus Data Receiver | Listen |
| Send | Azure Service Bus Data Sender | Send |

Being Owner or Contributor of the resource does not give access to messages; the data roles are required.

A connection string for a single queue (with `EntityPath`) works without the Manage claim: that queue is shown, without counts.

## Settings

| Setting | Default | Description |
|---|---|---|
| `serviceBusWorkbench.peekBatchSize` | 50 | Messages to peek or receive at a time |
| `serviceBusWorkbench.useWebSockets` | false | Use AMQP over WebSockets (port 443) when a firewall blocks port 5671 |
| `serviceBusWorkbench.history.enabled` | true | Record sends and resends in the Sent History view |
| `serviceBusWorkbench.history.maxEntries` | 500 | Maximum number of history entries |

## Where your data is stored

- Connection strings are kept in VS Code secret storage, never in `settings.json`.
- The sent history is a `history.json` file in the extension's global storage, on your machine only. It contains message bodies: if you send sensitive data, turn the history off or clear it.

## Known limitations

- Queues only; topics and subscriptions are not supported yet.
- On session-enabled queues, peek and send work (set a Session ID), but receive and delete does not.
- With Entra ID, only subscriptions of the account's default tenant are listed. For another tenant, use "enter the namespace host name" and provide the tenant ID.
- A resend keeps the body, properties and IDs; it does not keep the time to live or the scheduled time.
- With the emulator, counts are obtained by peeking and are shown as `100+` from 100 messages.

## License

[MIT](https://github.com/dmoreano-dev/service-bus-workbench/blob/main/LICENSE)
