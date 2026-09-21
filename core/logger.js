import fs from "fs";
import path from "path";

function pad2(n) {
  return String(n).padStart(2, "0");
}

function timestampParts(date = new Date()) {
  const datePart = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  const timePart = `${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`;
  return { datePart, timePart };
}

export function buildLogFilename(label, extra, date = new Date()) {
  const { datePart, timePart } = timestampParts(date);
  return [datePart, label, extra, timePart].filter(Boolean).join("_") + ".json";
}

export class JsonLogger {
  constructor({ dir, filename, meta = {}, existingData = null }) {
    this.dir = dir;
    this.filePath = path.join(dir, filename);

    if (existingData) {
      this.meta = { ...existingData.meta, resumedAt: new Date().toISOString() };
      this.entries = existingData.entries ?? [];
      this.summary = existingData.summary ?? {};
    } else {
      this.meta = { startedAt: new Date().toISOString(), ...meta };
      this.entries = [];
      this.summary = {};
    }

    this._byTaskId = new Map(
      this.entries.filter((e) => e.taskId != null).map((e) => [e.taskId, e])
    );
  }

  static fromFile(filePath) {
    if (!fs.existsSync(filePath)) return null;
    try {
      return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    } catch {
      return null;
    }
  }

  hasTask(taskId, contentHash) {
    const entry = this._byTaskId.get(taskId);
    if (!entry) return false;
    return !contentHash || entry.contentHash === contentHash;
  }

  add(entry) {
    if (entry.taskId != null && this._byTaskId.has(entry.taskId)) {
      const idx = this.entries.findIndex((e) => e.taskId === entry.taskId);
      if (idx !== -1) this.entries[idx] = entry;
    } else {
      this.entries.push(entry);
    }
    if (entry.taskId != null) this._byTaskId.set(entry.taskId, entry);
    return entry;
  }

  setSummary(summary) {
    this.summary = summary;
  }

  write() {
    fs.mkdirSync(this.dir, { recursive: true });
    const payload = {
      meta: { ...this.meta, lastUpdatedAt: new Date().toISOString() },
      summary: this.summary,
      entries: this.entries,
    };
    fs.writeFileSync(this.filePath, JSON.stringify(payload, null, 2));
    return this.filePath;
  }
}
