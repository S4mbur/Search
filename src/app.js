const { CrawlerDatabase } = require("./db");
const { createServer } = require("./server");
const config = require("./config");
const { CrawlerService } = require("./crawler/CrawlerService");

async function main() {
  const db = new CrawlerDatabase(config.DB_PATH);
  const crawlerService = new CrawlerService({ db, config });
  await crawlerService.start();

  const server = createServer({ crawlerService, config });
  server.listen(config.PORT, config.HOST, () => {
    process.stdout.write(
      `Crawler API listening on http://${config.HOST}:${config.PORT}\n`,
    );
  });

  const shutdown = async () => {
    server.close();
    await crawlerService.stop();
    db.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
