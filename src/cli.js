const config = require("./config");

async function main() {
  const [, , command, ...args] = process.argv;

  if (!command || command === "help") {
    printHelp();
    return;
  }

  if (command === "server") {
    require("./app");
    return;
  }

  const baseUrl = `http://${config.HOST}:${config.PORT}`;

  if (command === "index") {
    const [origin, depth, ...rest] = args;
    if (!origin || depth === undefined) {
      throw new Error("Usage: node src/cli.js index <origin> <depth>");
    }

    const options = parseFlagPairs(rest);
    const response = await fetch(`${baseUrl}/api/index`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        origin,
        k: Number(depth),
        maxConcurrency: options.maxConcurrency,
        maxQueueSize: options.maxQueueSize,
        maxRequestsPerSecond: options.maxRequestsPerSecond,
        requestTimeoutMs: options.requestTimeoutMs,
        userAgent: options.userAgent,
      }),
    });

    return printJson(await response.json());
  }

  if (command === "jobs") {
    const response = await fetch(`${baseUrl}/api/jobs`);
    return printJson(await response.json());
  }

  if (command === "status") {
    const [jobId] = args;
    const target = jobId ? `/api/jobs/${jobId}` : "/api/system";
    const response = await fetch(`${baseUrl}${target}`);
    return printJson(await response.json());
  }

  if (command === "events") {
    const [jobId, after = "0"] = args;
    if (!jobId) {
      throw new Error("Usage: node src/cli.js events <jobId> [afterId]");
    }

    const response = await fetch(`${baseUrl}/api/jobs/${jobId}/events?after=${after}`);
    return printJson(await response.json());
  }

  if (command === "search") {
    const query = args.join(" ").trim();
    if (!query) {
      throw new Error("Usage: node src/cli.js search <query>");
    }

    const response = await fetch(
      `${baseUrl}/api/search?q=${encodeURIComponent(query)}`,
    );
    return printJson(await response.json());
  }

  throw new Error(`Unknown command: ${command}`);
}

function parseFlagPairs(args) {
  const result = {};

  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith("--")) {
      continue;
    }

    result[key.slice(2)] = value;
  }

  return result;
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function printHelp() {
  process.stdout.write(
    [
      "Usage:",
      "  node src/cli.js server",
      "  node src/cli.js index <origin> <depth> [--maxConcurrency 4 --maxQueueSize 200 --maxRequestsPerSecond 2 --requestTimeoutMs 10000]",
      "  node src/cli.js jobs",
      "  node src/cli.js status [jobId]",
      "  node src/cli.js events <jobId> [afterId]",
      "  node src/cli.js search <query>",
    ].join("\n") + "\n",
  );
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
