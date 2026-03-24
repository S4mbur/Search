const fs = require("node:fs");
const path = require("node:path");

class CompatibilityStorage {
  constructor({ db, storageDir }) {
    this.db = db;
    this.storageDir = storageDir;
    fs.mkdirSync(this.storageDir, { recursive: true });
  }

  rebuild() {
    fs.mkdirSync(this.storageDir, { recursive: true });

    for (const file of fs.readdirSync(this.storageDir)) {
      if (file.endsWith(".data")) {
        fs.rmSync(path.join(this.storageDir, file), { force: true });
      }
    }

    const buckets = new Map();
    for (const entry of this.db.listStorageEntries()) {
      const shard = this.getShardName(entry.word);
      if (!buckets.has(shard)) {
        buckets.set(shard, []);
      }

      buckets.get(shard).push(
        `${entry.word} ${entry.url} ${entry.originUrl} ${entry.depth} ${entry.frequency}`,
      );
    }

    for (const [shard, lines] of buckets.entries()) {
      fs.writeFileSync(path.join(this.storageDir, `${shard}.data`), `${lines.join("\n")}\n`);
    }
  }

  getShardName(word) {
    const first = String(word || "").charAt(0).toLowerCase();
    if (/[a-z]/.test(first)) {
      return first;
    }

    if (/[0-9]/.test(first)) {
      return "0";
    }

    return "_";
  }
}

module.exports = {
  CompatibilityStorage,
};
