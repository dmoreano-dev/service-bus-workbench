# Changelog

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
