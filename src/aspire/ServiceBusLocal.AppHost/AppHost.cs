using System.Runtime.InteropServices;

var builder = DistributedApplication.CreateBuilder(args);

var serviceBus = builder.AddAzureServiceBus("servicebus")
    .RunAsEmulator(emulator => emulator
        .WithHostPort(5672)
        .WithImageTag("2.0.1")
        .WithEndpoint("emulatorhealth", endpoint => endpoint.Port = 5300));

serviceBus.AddServiceBusQueue("orders");
serviceBus.AddServiceBusQueue("payments");
serviceBus.AddServiceBusQueue("notifications");

// The emulator stores its state in SQL Server, whose image is amd64-only and crashes under
// QEMU emulation on Apple Silicon. Azure SQL Edge has a native arm64 image and works as a backend.
if (RuntimeInformation.OSArchitecture == Architecture.Arm64)
{
    var sql = builder.Resources.OfType<ContainerResource>().Single(r => r.Name == "servicebus-mssql");
    builder.CreateResourceBuilder(sql)
        .WithImageRegistry("mcr.microsoft.com")
        .WithImage("azure-sql-edge", "latest");
}

var extensionDir = Path.GetFullPath(Path.Combine(builder.AppHostDirectory, "..", "..", "code-extension"));

var seed = builder.AddExecutable("seed", "npm", extensionDir, "run", "seed:local")
    .WaitFor(serviceBus);

builder.AddExecutable("extension-watch", "npm", extensionDir, "run", "watch");
builder.AddExecutable("extension-host", "npm", extensionDir, "run", "host")
    .WaitForCompletion(seed);

builder.Build().Run();
