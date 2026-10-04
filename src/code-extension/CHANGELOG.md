# Changelog

## 0.7.3 (pre-release)

- Errors in the messages and send panels are shown in a box instead of plain red text, with the explanation of what to fix first and the answer from Service Bus below it.
- In the send form, the status is shown below the buttons instead of next to them.

## 0.7.2 (pre-release)

- "Send Message" on a queue or topic whose compose form is already open focuses that tab instead of opening another one, and keeps the draft. Resending a message still opens its own tab.
- Sending a message with an empty body now notes it in case it was an oversight.

## 0.7.1 (pre-release)

- Sending, receiving or moving messages reloads only the queue or topic involved in the tree, not every entity of every connection.

## 0.7.0 (pre-release)

- Connection names are unique: adding a connection with a name that is already in use is refused, ignoring case. When the suggested name is taken, a free one is proposed.

## 0.6.0

- Topics and subscriptions: they appear in the tree next to the queues, with their counts. Peek, receive and delete, and the dead-letter queue work on a subscription; sending works on a topic.
- Resend several messages at once: tick the rows and select "Resend selected".
- "Move back" in a dead-letter queue sends messages again to their queue or topic and removes them from the dead-letter queue: the rows you ticked, or the oldest ones up to the count when none is ticked.
- Read-only mode for a connection: sending, receiving and moving messages are hidden and refused.
- New way to connect with Microsoft Entra ID: Azure CLI or environment credentials (`DefaultAzureCredential`).
- With only the Reader role on a namespace, its queues, topics and subscriptions are listed through Azure Resource Manager. Applies to connections added with "browse my subscriptions" from this version on.
- Adding a connection checks that it works before saving it: that it can list the namespace, or read the queue when the connection string is for a single queue. When it cannot, you see why and can still add it, unless the key of the connection string is wrong.
- Emulator: a connection string for an emulator asks for the management port, so it can run on another host or port.
- Sent history: search, and grouping by queue or by day.

## 0.4.0

- Adding a connection with Microsoft Entra ID is available again, now verified against a real Azure namespace.
- "Browse my subscriptions" lists the subscriptions of every tenant of the account, not only the default one. Personal Microsoft accounts no longer get an empty list.
- A missing permission is reported in a couple of seconds. Before, the panel waited 90 seconds and then showed nothing.
- Permission errors explain that being Owner of the namespace is not enough to read or send messages: the Azure Service Bus data roles are required.

## 0.2.0

First stable release.

- Adding a connection with Microsoft Entra ID is hidden until it is verified against a real Azure namespace. Use a connection string or the local emulator.

## 0.1.0 (pre-release)

First public version.

- Connect with a connection string, with Microsoft Entra ID, or to the local emulator.
- Queue tree with active and dead-letter message counts.
- Peek a queue and its dead-letter queue, with paging.
- Receive and delete, with confirmation.
- Send messages, and resend a message you are looking at.
- Sent history of every send and resend.
