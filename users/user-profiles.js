import fs from "fs";
import path from "path";
import { KNOWLEDGE_MODE } from "../app-config.js";

const USERS_DIR = "users";

// Profile names become filenames (`users/<name>.json`); only letters, digits,
// space, underscore, and hyphen are allowed — no dots or path separators.
const VALID_NAME = /^[A-Za-z0-9 _-]+$/;

export function isValidUserName(name) {
  return typeof name === "string" && VALID_NAME.test(name);
}

function assertValidUserName(name) {
  if (!isValidUserName(name)) {
    throw new Error(`Invalid user name: ${JSON.stringify(name)}`);
  }
}

export const TOPICS = {
  active_cruise_control:          "Active Cruise Control (ACC)",
  manual_speed_limiter:           "Manual Speed Limiter",
  speed_limit_assistant:          "Speed Limit Assistant",
  steering_assistant:             "Steering / Lane Keeping Assistant",
  extended_traffic_jam_assistant: "Extended Traffic Jam Assistant",
  automatic_lane_change:          "Automatic Lane Change",
};

export const LEVEL_LABELS = ["Beginner", "Intermediate", "Expert"];

const defaultKnowledge = () =>
  Object.fromEntries(Object.keys(TOPICS).map((k) => [k, 0]));

const defaultNotes = () =>
  Object.fromEntries(Object.keys(TOPICS).map((k) => [k, ""]));

export function loadUser(name) {
  assertValidUserName(name);
  const file = path.join(USERS_DIR, `${name}.json`);
  if (fs.existsSync(file)) {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    data.knowledge      = { ...defaultKnowledge(), ...data.knowledge };
    data.knowledgeNotes = { ...defaultNotes(),     ...data.knowledgeNotes };
    return data;
  }
  return { name, lastSeen: null, knowledge: defaultKnowledge(), knowledgeNotes: defaultNotes() };
}

export function saveUser(profile) {
  assertValidUserName(profile?.name);
  if (!fs.existsSync(USERS_DIR)) fs.mkdirSync(USERS_DIR, { recursive: true });
  profile.lastSeen = new Date().toISOString();
  fs.writeFileSync(
    path.join(USERS_DIR, `${profile.name}.json`),
    JSON.stringify(profile, null, 2)
  );
}

export function knowledgeSummary(profile) {
  if (KNOWLEDGE_MODE === "descriptions") {
    return Object.entries(TOPICS)
      .map(([k, label]) => {
        const note = profile.knowledgeNotes?.[k];
        return `  ${label}: ${note || "No knowledge recorded yet"}`;
      })
      .join("\n");
  }
  return Object.entries(profile.knowledge)
    .map(([k, v]) => `  ${TOPICS[k]}: ${LEVEL_LABELS[v] ?? LEVEL_LABELS[0]} (${v}/2)`)
    .join("\n");
}

export function applyScoreUpdates(profile, updates) {
  for (const [topic, score] of Object.entries(updates)) {
    if (!(topic in profile.knowledge)) continue;
    if (typeof score !== "number") continue;
    const clamped = Math.min(2, Math.max(0, Math.round(score)));
    if (clamped > profile.knowledge[topic]) {
      profile.knowledge[topic] = clamped;
    }
  }
}

export function applyNoteUpdates(profile, updates) {
  for (const [topic, note] of Object.entries(updates)) {
    if (!(topic in profile.knowledgeNotes)) continue;
    if (typeof note !== "string") continue;
    profile.knowledgeNotes[topic] = note.trim();
  }
}
