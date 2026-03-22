const test = require("node:test");
const assert = require("node:assert/strict");
const { CrawlerDatabase } = require("../src/db");
const { CrawlerService } = require("../src/crawler/CrawlerService");

function makeConfig() {
  return {
    DB_PATH: ":memory:",
    HOST: "127.0.0.1",
    PORT: 3000,
    DEFAULT_MAX_CONCURRENCY: 4,
    DEFAULT_MAX_QUEUE_SIZE: 2,
    DEFAULT_MAX_REQUESTS_PER_SECOND: 100,
    DEFAULT_REQUEST_TIMEOUT_MS: 1000,
    DEFAULT_USER_AGENT: "TestCrawler/1.0",
    SCHEDULER_INTERVAL_MS: 10,
    MAX_EVENTS_PER_RESPONSE: 200,
    MAX_SEARCH_RESULTS: 100,
  };
}

test("crawler indexes pages, applies backpressure, and reuses indexed pages across jobs", async () => {
  const pages = {
    "http://site.test/": `
      <html><head><title>Home</title></head><body>
        Search crawler home page.
        <a href="/about">About</a>
        <a href="/docs">Docs</a>
      </body></html>
    `,
    "http://site.test/about": `
      <html><head><title>About</title></head><body>
        About the crawler assignment.
        <a href="/team">Team</a>
      </body></html>
    `,
    "http://site.test/docs": `
      <html><head><title>Docs</title></head><body>
        Search results and crawler pipeline documentation.
      </body></html>
    `,
    "http://site.test/team": `
      <html><head><title>Team</title></head><body>
        Team page that should only be discovered at depth 2.
      </body></html>
    `,
  };

  const hits = new Map();
  const fetchImpl = async (url) => {
    hits.set(url, (hits.get(url) || 0) + 1);
    const body = pages[url];
    if (!body) {
      return new Response("Not found", {
        status: 404,
        headers: { "content-type": "text/html" },
      });
    }

    return new Response(body, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  };

  const db = new CrawlerDatabase(":memory:");
  const service = new CrawlerService({
    db,
    config: makeConfig(),
    fetchImpl,
  });

  await service.start();

  try {
    const job = service.createIndexJob({
      originUrl: "http://site.test/",
      maxDepth: 2,
      options: {
        maxQueueSize: 1,
        maxRequestsPerSecond: 100,
        maxConcurrency: 2,
      },
    });

    const completedJob = await service.waitForJobCompletion(job.id, 3000);
    assert.equal(completedJob.status, "completed");
    assert.equal(hits.get("http://site.test/"), 1);
    assert.equal(hits.get("http://site.test/about"), 1);
    assert.equal(hits.get("http://site.test/docs"), 1);
    assert.equal(hits.get("http://site.test/team"), 1);
    assert.ok(completedJob.metrics.pendingCount >= 1);

    const search = service.search("crawler search", 10);
    assert.ok(
      search.results.some(
        (result) =>
          result.relevantUrl === "http://site.test/about" &&
          result.originUrl === "http://site.test/" &&
          result.depth === 1,
      ),
    );

    const secondJob = service.createIndexJob({
      originUrl: "http://site.test/about",
      maxDepth: 0,
    });

    const completedSecondJob = await service.waitForJobCompletion(secondJob.id, 3000);
    assert.equal(completedSecondJob.status, "completed");
    assert.equal(hits.get("http://site.test/about"), 1);

    const secondSearch = service.search("assignment", 20);
    assert.ok(
      secondSearch.results.some(
        (result) =>
          result.relevantUrl === "http://site.test/about" &&
          result.originUrl === "http://site.test/about" &&
          result.depth === 0,
      ),
    );
  } finally {
    await service.stop();
    db.close();
  }
});
