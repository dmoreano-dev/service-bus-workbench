# Service Bus Workbench

A VS Code extension to explore Azure Service Bus: list queues, peek, receive and delete, send messages, and keep a history of everything you sent or resent.

Features, permissions, settings and limitations: [extension README](src/code-extension/README.md).

## Run it locally

Requirements: Node.js 20+, VS Code 1.90+ with the `code` command on your PATH, .NET SDK 10, and Docker running.

```bash
npm --prefix src/code-extension install               # first time only
dotnet run --project src/aspire/ServiceBusLocal.AppHost
```

The AppHost starts the Service Bus emulator with three queues, loads sample messages, and opens a VS Code window with the extension, which reloads on its own when you save a change. In that window: **Service Bus Workbench** icon → **Add Connection → Local emulator**.

To debug with breakpoints, open the repository root in VS Code and press `F5`.

## Commands

From `src/code-extension`:

| Command | What it does |
|---|---|
| `npm run compile` | Type-checks and builds the bundle |
| `npm run watch` | Rebuilds on save |
| `npm run seed:local` | Loads sample messages into the emulator |
| `npm run vsix` | Builds the installable `.vsix` |

To install the package: `code --install-extension service-bus-workbench-<version>.vsix`.

## Publish a version

1. Bump `version` in `src/code-extension/package.json` and add the entry to `src/code-extension/CHANGELOG.md`. Odd minor for a pre-release (`0.1.x`), even for a stable version (`0.2.x`).
2. Commit and push to `main`.
3. Tag that commit and push the tag:

   ```bash
   git tag v0.1.0
   git push origin v0.1.0
   ```

The `Release` workflow packages the `.vsix`, publishes it to the Marketplace (as a pre-release when the minor version is odd), and creates the GitHub Release with the `.vsix` attached.

## License

[MIT](LICENSE)
