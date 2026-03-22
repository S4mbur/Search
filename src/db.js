const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

class CrawlerDatabase {
  constructor(dbPath) {
    this.dbPath = dbPath;

    if (dbPath !== ":memory:") {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }

    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA synchronous = NORMAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.initialize();
  }

  initialize() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        origin_url TEXT NOT NULL,
        max_depth INTEGER NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT,
        last_error TEXT,
        config_json TEXT NOT NULL,
        metrics_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS job_discoveries (
        job_id TEXT NOT NULL,
        url TEXT NOT NULL,
        depth INTEGER NOT NULL,
        discovered_from TEXT,
        discovered_at TEXT NOT NULL,
        PRIMARY KEY (job_id, url),
        FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS job_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL,
        url TEXT NOT NULL,
        depth INTEGER NOT NULL,
        discovered_from TEXT,
        enqueued_at TEXT NOT NULL,
        UNIQUE (job_id, url),
        FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS job_pending (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL,
        url TEXT NOT NULL,
        depth INTEGER NOT NULL,
        discovered_from TEXT,
        enqueued_at TEXT NOT NULL,
        UNIQUE (job_id, url),
        FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS job_inflight (
        job_id TEXT NOT NULL,
        url TEXT NOT NULL,
        depth INTEGER NOT NULL,
        discovered_from TEXT,
        started_at TEXT NOT NULL,
        PRIMARY KEY (job_id, url),
        FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS job_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL,
        level TEXT NOT NULL,
        message TEXT NOT NULL,
        data_json TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS visited_urls (
        url TEXT PRIMARY KEY,
        first_job_id TEXT NOT NULL,
        first_visited_at TEXT NOT NULL,
        FOREIGN KEY (first_job_id) REFERENCES jobs(id)
      );

      CREATE TABLE IF NOT EXISTS pages (
        url TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        excerpt TEXT NOT NULL,
        body_text TEXT NOT NULL,
        content_type TEXT NOT NULL,
        status_code INTEGER NOT NULL,
        crawled_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS page_contexts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url TEXT NOT NULL,
        job_id TEXT NOT NULL,
        origin_url TEXT NOT NULL,
        depth INTEGER NOT NULL,
        discovered_from TEXT,
        discovered_at TEXT NOT NULL,
        UNIQUE (url, job_id, origin_url, depth),
        FOREIGN KEY (url) REFERENCES pages(url) ON DELETE CASCADE,
        FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS crawl_edges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_url TEXT NOT NULL,
        to_url TEXT NOT NULL,
        job_id TEXT NOT NULL,
        origin_url TEXT NOT NULL,
        depth INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (job_id, from_url, to_url),
        FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS page_terms (
        term TEXT NOT NULL,
        url TEXT NOT NULL,
        tf INTEGER NOT NULL,
        doc_length INTEGER NOT NULL,
        PRIMARY KEY (term, url),
        FOREIGN KEY (url) REFERENCES pages(url) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_job_queue_job_id ON job_queue(job_id, id);
      CREATE INDEX IF NOT EXISTS idx_job_pending_job_id ON job_pending(job_id, id);
      CREATE INDEX IF NOT EXISTS idx_job_inflight_job_id ON job_inflight(job_id);
      CREATE INDEX IF NOT EXISTS idx_job_events_job_id ON job_events(job_id, id);
      CREATE INDEX IF NOT EXISTS idx_page_terms_term ON page_terms(term);
      CREATE INDEX IF NOT EXISTS idx_page_contexts_url ON page_contexts(url);
    `);
  }

  close() {
    this.db.close();
  }

  withTransaction(fn) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  createJob(job) {
    const statement = this.db.prepare(`
      INSERT INTO jobs (
        id, origin_url, max_depth, status, created_at, updated_at, completed_at,
        last_error, config_json, metrics_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    statement.run(
      job.id,
      job.originUrl,
      job.maxDepth,
      job.status,
      job.createdAt,
      job.updatedAt,
      job.completedAt || null,
      job.lastError || null,
      JSON.stringify(job.config),
      JSON.stringify(job.metrics),
    );
  }

  saveJob(job) {
    const statement = this.db.prepare(`
      UPDATE jobs
      SET status = ?,
          updated_at = ?,
          completed_at = ?,
          last_error = ?,
          config_json = ?,
          metrics_json = ?
      WHERE id = ?
    `);

    statement.run(
      job.status,
      job.updatedAt,
      job.completedAt || null,
      job.lastError || null,
      JSON.stringify(job.config),
      JSON.stringify(job.metrics),
      job.id,
    );
  }

  getJob(jobId) {
    const row = this.db
      .prepare(`
        SELECT
          j.*,
          (SELECT COUNT(*) FROM job_queue jq WHERE jq.job_id = j.id) AS queue_count,
          (SELECT COUNT(*) FROM job_pending jp WHERE jp.job_id = j.id) AS pending_count,
          (SELECT COUNT(*) FROM job_inflight ji WHERE ji.job_id = j.id) AS inflight_count,
          (SELECT COUNT(*) FROM job_events je WHERE je.job_id = j.id) AS event_count
        FROM jobs j
        WHERE j.id = ?
      `)
      .get(jobId);

    return row ? this.#hydrateJob(row) : null;
  }

  listJobs(limit = 50) {
    const rows = this.db
      .prepare(`
        SELECT
          j.*,
          (SELECT COUNT(*) FROM job_queue jq WHERE jq.job_id = j.id) AS queue_count,
          (SELECT COUNT(*) FROM job_pending jp WHERE jp.job_id = j.id) AS pending_count,
          (SELECT COUNT(*) FROM job_inflight ji WHERE ji.job_id = j.id) AS inflight_count,
          (SELECT COUNT(*) FROM job_events je WHERE je.job_id = j.id) AS event_count
        FROM jobs j
        ORDER BY j.created_at DESC
        LIMIT ?
      `)
      .all(limit);

    return rows.map((row) => this.#hydrateJob(row));
  }

  listActiveJobs() {
    const rows = this.db
      .prepare(`
        SELECT
          j.*,
          (SELECT COUNT(*) FROM job_queue jq WHERE jq.job_id = j.id) AS queue_count,
          (SELECT COUNT(*) FROM job_pending jp WHERE jp.job_id = j.id) AS pending_count,
          (SELECT COUNT(*) FROM job_inflight ji WHERE ji.job_id = j.id) AS inflight_count,
          (SELECT COUNT(*) FROM job_events je WHERE je.job_id = j.id) AS event_count
        FROM jobs j
        WHERE j.status IN ('queued', 'running')
        ORDER BY j.created_at ASC
      `)
      .all();

    return rows.map((row) => this.#hydrateJob(row));
  }

  appendEvent(jobId, level, message, data = null, createdAt = new Date().toISOString()) {
    this.db
      .prepare(`
        INSERT INTO job_events (job_id, level, message, data_json, created_at)
        VALUES (?, ?, ?, ?, ?)
      `)
      .run(jobId, level, message, data ? JSON.stringify(data) : null, createdAt);
  }

  listEvents(jobId, afterId = 0, limit = 100) {
    const rows = this.db
      .prepare(`
        SELECT id, job_id, level, message, data_json, created_at
        FROM job_events
        WHERE job_id = ? AND id > ?
        ORDER BY id ASC
        LIMIT ?
      `)
      .all(jobId, afterId, limit);

    return rows.map((row) => ({
      id: row.id,
      jobId: row.job_id,
      level: row.level,
      message: row.message,
      data: row.data_json ? JSON.parse(row.data_json) : null,
      createdAt: row.created_at,
    }));
  }

  registerDiscoveredUrl(jobId, url, depth, discoveredFrom, discoveredAt) {
    const result = this.db
      .prepare(`
        INSERT OR IGNORE INTO job_discoveries (job_id, url, depth, discovered_from, discovered_at)
        VALUES (?, ?, ?, ?, ?)
      `)
      .run(jobId, url, depth, discoveredFrom || null, discoveredAt);

    return result.changes > 0;
  }

  enqueue(jobId, url, depth, discoveredFrom, targetTable, enqueuedAt) {
    const tableName = targetTable === "pending" ? "job_pending" : "job_queue";
    const result = this.db
      .prepare(`
        INSERT OR IGNORE INTO ${tableName} (job_id, url, depth, discovered_from, enqueued_at)
        VALUES (?, ?, ?, ?, ?)
      `)
      .run(jobId, url, depth, discoveredFrom || null, enqueuedAt);

    return result.changes > 0;
  }

  popNextQueuedItemToInflight(jobId, startedAt) {
    return this.withTransaction(() => {
      const row = this.db
        .prepare(`
          SELECT id, job_id, url, depth, discovered_from, enqueued_at
          FROM job_queue
          WHERE job_id = ?
          ORDER BY id ASC
          LIMIT 1
        `)
        .get(jobId);

      if (!row) {
        return null;
      }

      this.db.prepare("DELETE FROM job_queue WHERE id = ?").run(row.id);
      this.db
        .prepare(`
          INSERT OR REPLACE INTO job_inflight (job_id, url, depth, discovered_from, started_at)
          VALUES (?, ?, ?, ?, ?)
        `)
        .run(row.job_id, row.url, row.depth, row.discovered_from, startedAt);

      return {
        id: row.id,
        jobId: row.job_id,
        url: row.url,
        depth: row.depth,
        discoveredFrom: row.discovered_from,
        enqueuedAt: row.enqueued_at,
      };
    });
  }

  clearInflightItem(jobId, url) {
    this.db
      .prepare("DELETE FROM job_inflight WHERE job_id = ? AND url = ?")
      .run(jobId, url);
  }

  requeueInflightItems(jobId) {
    return this.withTransaction(() => {
      const rows = this.db
        .prepare(`
          SELECT job_id, url, depth, discovered_from, started_at
          FROM job_inflight
          WHERE job_id = ?
        `)
        .all(jobId);

      const insert = this.db.prepare(`
        INSERT OR IGNORE INTO job_queue (job_id, url, depth, discovered_from, enqueued_at)
        VALUES (?, ?, ?, ?, ?)
      `);

      for (const row of rows) {
        insert.run(
          row.job_id,
          row.url,
          row.depth,
          row.discovered_from,
          row.started_at,
        );
      }

      this.db.prepare("DELETE FROM job_inflight WHERE job_id = ?").run(jobId);
      return rows.length;
    });
  }

  promotePendingToQueue(jobId, capacity) {
    if (capacity <= 0) {
      return 0;
    }

    return this.withTransaction(() => {
      const rows = this.db
        .prepare(`
          SELECT id, url, depth, discovered_from, enqueued_at
          FROM job_pending
          WHERE job_id = ?
          ORDER BY id ASC
          LIMIT ?
        `)
        .all(jobId, capacity);

      let moved = 0;
      for (const row of rows) {
        const inserted = this.db
          .prepare(`
            INSERT OR IGNORE INTO job_queue (job_id, url, depth, discovered_from, enqueued_at)
            VALUES (?, ?, ?, ?, ?)
          `)
          .run(jobId, row.url, row.depth, row.discovered_from, row.enqueued_at);

        this.db.prepare("DELETE FROM job_pending WHERE id = ?").run(row.id);
        if (inserted.changes > 0) {
          moved += 1;
        }
      }

      return moved;
    });
  }

  getQueueCounts(jobId) {
    const queueCount = this.db
      .prepare("SELECT COUNT(*) AS count FROM job_queue WHERE job_id = ?")
      .get(jobId).count;
    const pendingCount = this.db
      .prepare("SELECT COUNT(*) AS count FROM job_pending WHERE job_id = ?")
      .get(jobId).count;
    const inflightCount = this.db
      .prepare("SELECT COUNT(*) AS count FROM job_inflight WHERE job_id = ?")
      .get(jobId).count;

    return {
      queueCount,
      pendingCount,
      inflightCount,
    };
  }

  listRunnableJobs() {
    return this.db
      .prepare(`
        SELECT
          j.id,
          j.origin_url,
          j.max_depth,
          j.status,
          (SELECT COUNT(*) FROM job_queue jq WHERE jq.job_id = j.id) AS queue_count,
          (SELECT COUNT(*) FROM job_pending jp WHERE jp.job_id = j.id) AS pending_count,
          (SELECT COUNT(*) FROM job_inflight ji WHERE ji.job_id = j.id) AS inflight_count
        FROM jobs j
        WHERE j.status IN ('queued', 'running')
        ORDER BY j.created_at ASC
      `)
      .all();
  }

  markVisited(url, jobId, visitedAt) {
    const result = this.db
      .prepare(`
        INSERT OR IGNORE INTO visited_urls (url, first_job_id, first_visited_at)
        VALUES (?, ?, ?)
      `)
      .run(url, jobId, visitedAt);

    return result.changes > 0;
  }

  hasVisited(url) {
    const row = this.db
      .prepare("SELECT 1 AS found FROM visited_urls WHERE url = ?")
      .get(url);

    return Boolean(row);
  }

  getPage(url) {
    const row = this.db.prepare("SELECT * FROM pages WHERE url = ?").get(url);
    if (!row) {
      return null;
    }

    return {
      url: row.url,
      title: row.title,
      excerpt: row.excerpt,
      bodyText: row.body_text,
      contentType: row.content_type,
      statusCode: row.status_code,
      crawledAt: row.crawled_at,
    };
  }

  upsertPage(page) {
    this.db
      .prepare(`
        INSERT INTO pages (url, title, excerpt, body_text, content_type, status_code, crawled_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(url) DO UPDATE SET
          title = excluded.title,
          excerpt = excluded.excerpt,
          body_text = excluded.body_text,
          content_type = excluded.content_type,
          status_code = excluded.status_code,
          crawled_at = excluded.crawled_at
      `)
      .run(
        page.url,
        page.title,
        page.excerpt,
        page.bodyText,
        page.contentType,
        page.statusCode,
        page.crawledAt,
      );
  }

  addPageContext(context) {
    const result = this.db
      .prepare(`
        INSERT OR IGNORE INTO page_contexts (
          url, job_id, origin_url, depth, discovered_from, discovered_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `)
      .run(
        context.url,
        context.jobId,
        context.originUrl,
        context.depth,
        context.discoveredFrom || null,
        context.discoveredAt,
      );

    return result.changes > 0;
  }

  addCrawlEdge(edge) {
    this.db
      .prepare(`
        INSERT OR IGNORE INTO crawl_edges (
          from_url, to_url, job_id, origin_url, depth, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `)
      .run(
        edge.fromUrl,
        edge.toUrl,
        edge.jobId,
        edge.originUrl,
        edge.depth,
        edge.createdAt,
      );
  }

  replacePageTerms(url, frequencies, docLength) {
    this.db.prepare("DELETE FROM page_terms WHERE url = ?").run(url);

    const insert = this.db.prepare(`
      INSERT INTO page_terms (term, url, tf, doc_length)
      VALUES (?, ?, ?, ?)
    `);

    for (const [term, tf] of frequencies.entries()) {
      insert.run(term, url, tf, docLength);
    }
  }

  search(terms, limit) {
    if (terms.length === 0) {
      return [];
    }

    const placeholders = terms.map(() => "?").join(", ");
    const baseSql = `
      SELECT
        p.url AS relevant_url,
        p.title AS title,
        p.excerpt AS excerpt,
        pc.origin_url AS origin_url,
        pc.depth AS depth,
        pc.job_id AS job_id,
        SUM(pt.tf) AS score,
        COUNT(DISTINCT pt.term) AS matched_terms
      FROM page_terms pt
      JOIN pages p ON p.url = pt.url
      JOIN page_contexts pc ON pc.url = p.url
      WHERE pt.term IN (${placeholders})
      GROUP BY p.url, pc.origin_url, pc.depth, pc.job_id
      ORDER BY matched_terms DESC, score DESC, depth ASC, relevant_url ASC
    `;

    const statement = this.db.prepare(
      limit ? `${baseSql}\n      LIMIT ?` : baseSql,
    );

    const rows = limit ? statement.all(...terms, limit) : statement.all(...terms);

    return rows.map((row) => ({
      relevantUrl: row.relevant_url,
      originUrl: row.origin_url,
      depth: row.depth,
      jobId: row.job_id,
      title: row.title,
      excerpt: row.excerpt,
      score: row.score,
      matchedTerms: row.matched_terms,
    }));
  }

  getSystemStatus() {
    const pages = this.db.prepare("SELECT COUNT(*) AS count FROM pages").get().count;
    const visited = this.db
      .prepare("SELECT COUNT(*) AS count FROM visited_urls")
      .get().count;
    const activeJobs = this.db
      .prepare(
        "SELECT COUNT(*) AS count FROM jobs WHERE status IN ('queued', 'running')",
      )
      .get().count;
    const queued = this.db.prepare("SELECT COUNT(*) AS count FROM job_queue").get().count;
    const pending = this.db
      .prepare("SELECT COUNT(*) AS count FROM job_pending")
      .get().count;
    const inflight = this.db
      .prepare("SELECT COUNT(*) AS count FROM job_inflight")
      .get().count;

    return {
      pages,
      visited,
      activeJobs,
      queued,
      pending,
      inflight,
    };
  }

  #hydrateJob(row) {
    return {
      id: row.id,
      originUrl: row.origin_url,
      maxDepth: row.max_depth,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at,
      lastError: row.last_error,
      config: JSON.parse(row.config_json),
      metrics: JSON.parse(row.metrics_json),
      queueCount: row.queue_count,
      pendingCount: row.pending_count,
      inflightCount: row.inflight_count,
      eventCount: row.event_count,
    };
  }
}

module.exports = {
  CrawlerDatabase,
};
