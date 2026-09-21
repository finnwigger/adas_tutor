// ── Topic display names ────────────────────────────────────────────────────
const TOPIC_NAMES = {
  active_cruise_control:          "Active Cruise Control",
  manual_speed_limiter:           "Manual Speed Limiter",
  speed_limit_assistant:          "Speed Limit Assistant",
  steering_assistant:             "Steering Assistant",
  extended_traffic_jam_assistant: "Traffic Jam Assist",
  automatic_lane_change:          "Auto Lane Change",
};

const LEVEL_LABELS = ["Beginner", "Intermediate", "Expert"];

// ── Onboarding questions ───────────────────────────────────────────────────
// Two options only per topic: haven't used it (0) or used it before (1).
// Score 2 (Expert) is only reached through actual use tracked by the LLM.
const ONBOARDING_STEPS = [
  {
    key: "active_cruise_control", label: "Active Cruise Control",
    hint: "Maintains your speed and following distance automatically.",
    options: [
      { text: "Haven't used it", score: 0, note: "" },
      { text: "I've used it before", score: 1, note: "Has used Active Cruise Control before." },
    ],
  },
  {
    key: "manual_speed_limiter", label: "Manual Speed Limiter",
    hint: "Prevents your vehicle exceeding a speed you set yourself.",
    options: [
      { text: "Haven't used it", score: 0, note: "" },
      { text: "I've used it before", score: 1, note: "Has used the Manual Speed Limiter before." },
    ],
  },
  {
    key: "speed_limit_assistant", label: "Speed Limit Assistant",
    hint: "Reads road signs and suggests or enforces the current speed limit.",
    options: [
      { text: "Haven't used it", score: 0, note: "" },
      { text: "I've used it before", score: 1, note: "Has used the Speed Limit Assistant before." },
    ],
  },
  {
    key: "steering_assistant", label: "Steering Assistant",
    hint: "Keeps you centred in your lane and reduces steering effort.",
    options: [
      { text: "Haven't used it", score: 0, note: "" },
      { text: "I've used it before", score: 1, note: "Has used the Steering Assistant before." },
    ],
  },
  {
    key: "extended_traffic_jam_assistant", label: "Traffic Jam Assistant",
    hint: "Handles stop-and-go traffic automatically at low speeds.",
    options: [
      { text: "Haven't used it", score: 0, note: "" },
      { text: "I've used it before", score: 1, note: "Has used the Traffic Jam Assistant before." },
    ],
  },
  {
    key: "automatic_lane_change", label: "Automatic Lane Change",
    hint: "Moves your vehicle to an adjacent lane automatically when you indicate.",
    options: [
      { text: "Haven't used it", score: 0, note: "" },
      { text: "I've used it before", score: 1, note: "Has used Automatic Lane Change before." },
    ],
  },
];

// ── State ──────────────────────────────────────────────────────────────────
const state = {
  users:         [],
  username:      null,
  profile:       null,
  mode:          "pre-drive",
  knowledgeMode: "scores",
  history:       [],        // [{role:"human"|"ai", content:string}]
  sessionId:     null,      // regenerated whenever the conversation is reset
  streaming:     false,
  listening:     false,
  ttsEnabled:    true,
};

// ── Onboarding state ───────────────────────────────────────────────────────
const ob = { step: -1, usedAdas: null, answers: {}, notes: {}, selected: null, selectedNote: "" };

// ── DOM refs ───────────────────────────────────────────────────────────────
const userInput    = document.getElementById("user-input");
const userDropdown = document.getElementById("user-dropdown");
const topicsList   = document.getElementById("topics-list");
const modeBadge    = document.getElementById("mode-badge");
const headerUser   = document.getElementById("header-user");
const messagesEl   = document.getElementById("messages");
const welcomeMsg   = document.getElementById("welcome-msg");
const chatInput    = document.getElementById("chat-input");
const sendBtn      = document.getElementById("send-btn");
const micBtn       = document.getElementById("mic-btn");
const ttsBtn       = document.getElementById("tts-btn");
const clearBtn     = document.getElementById("clear-btn");
const obModal      = document.getElementById("ob-modal");
const obBody       = document.getElementById("ob-body");
const obFooter     = document.getElementById("ob-footer");
const obProg       = document.getElementById("ob-progress");

// ── Init ───────────────────────────────────────────────────────────────────
async function init() {
  const [users, config] = await Promise.all([
    fetch("/api/users").then((r) => r.json()),
    fetch("/api/config").then((r) => r.json()),
  ]);
  state.users = users;
  state.knowledgeMode = config.knowledgeMode ?? "scores";
  setupEventListeners();
  setupSpeech();
}

// ── User selector ──────────────────────────────────────────────────────────
function showDropdown(filter = "") {
  const q = filter.trim().toLowerCase();
  const matches = q
    ? state.users.filter((u) => u.toLowerCase().includes(q))
    : state.users;

  userDropdown.innerHTML = "";

  if (!matches.length && !q) {
    const li = document.createElement("li");
    li.className = "empty-msg";
    li.textContent = "No saved drivers yet";
    userDropdown.appendChild(li);
  }

  for (const name of matches) {
    const li = document.createElement("li");
    li.textContent = name;
    li.addEventListener("mousedown", (e) => { e.preventDefault(); selectUser(name); });
    userDropdown.appendChild(li);
  }

  if (q && !state.users.find((u) => u.toLowerCase() === q)) {
    const li = document.createElement("li");
    li.className = "create-option";
    const display = filter.trim();
    li.textContent = `Create "${display}"`;
    li.addEventListener("mousedown", (e) => { e.preventDefault(); selectUser(display); });
    userDropdown.appendChild(li);
  }

  userDropdown.hidden = false;
}

function hideDropdown() { userDropdown.hidden = true; }

async function selectUser(name) {
  hideDropdown();
  userInput.value = name;
  state.username = name;
  state.profile = await fetch(`/api/user/${encodeURIComponent(name)}`).then((r) => r.json());

  if (!state.users.includes(name)) {
    state.users = [...state.users, name].sort();
  }

  headerUser.textContent = name;
  chatInput.disabled = false;
  chatInput.placeholder = DEFAULT_PLACEHOLDER;
  sendBtn.disabled = false;
  renderDashboard();

  if (isNewUser(state.profile)) {
    startOnboarding();
  } else {
    showWelcome();
  }
}

function isNewUser(profile) {
  return !profile.lastSeen && Object.values(profile.knowledge).every((v) => v === 0);
}

// ── Onboarding ─────────────────────────────────────────────────────────────
function startOnboarding() {
  ob.step = -1;
  ob.usedAdas = null;
  ob.answers = {};
  ob.notes = {};
  ob.selected = null;
  ob.selectedNote = "";
  obModal.hidden = false;
  renderObStep();
}

function renderObStep() {
  if (ob.step === -1) renderObWelcome();
  else renderObQuestion(ONBOARDING_STEPS[ob.step]);
}

function renderObWelcome() {
  obProg.style.width = "0%";
  obBody.innerHTML = `
    <div class="ob-welcome">
      <div class="ob-icon">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 2L3 7v6c0 5.25 3.75 10.14 9 11.25 5.25-1.11 9-6 9-11.25V7L12 2z"/>
        </svg>
      </div>
      <h2>Welcome, ${escapeHtml(state.username)}!</h2>
      <p>Have you used any ADAS features in your vehicle before?</p>
      <p class="ob-hint">Things like adaptive cruise control, lane keeping, or automatic speed limiting.</p>
    </div>`;
  obFooter.innerHTML = `
    <button class="ob-skip-btn" id="ob-no-adas">No, I'm new to all of these</button>
    <button class="ob-primary-btn" id="ob-has-adas">Yes, I've used some →</button>`;
  document.getElementById("ob-no-adas").onclick = () => {
    ob.usedAdas = false;
    completeOnboarding();
  };
  document.getElementById("ob-has-adas").onclick = () => {
    ob.usedAdas = true;
    advanceOnboarding();
  };
}

function renderObQuestion(step) {
  const total = ONBOARDING_STEPS.length;
  obProg.style.width = `${(ob.step / total) * 100}%`;

  obBody.innerHTML = `
    <div class="ob-step">
      <div class="ob-step-meta">
        <span class="ob-step-label">${step.label.toUpperCase()}</span>
        <span class="ob-step-count">${ob.step + 1} / ${total}</span>
      </div>
      <p class="ob-hint">${step.hint}</p>
      <div class="ob-options">
        ${step.options.map((opt) => `
          <button class="ob-option" data-score="${opt.score}" data-note="${escapeHtml(opt.note)}">
            <span class="ob-dot"></span>
            <span>${opt.text}</span>
          </button>`).join("")}
      </div>
    </div>`;

  const isLast = ob.step === ONBOARDING_STEPS.length - 1;
  obFooter.innerHTML = `
    <button class="ob-skip-btn" id="ob-skip">Haven't tried it</button>
    <button class="ob-primary-btn" id="ob-next" disabled>${isLast ? "Finish →" : "Next →"}</button>`;

  document.querySelectorAll(".ob-option").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".ob-option").forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");
      ob.selected = Number(btn.dataset.score);
      ob.selectedNote = btn.dataset.note ?? "";
      document.getElementById("ob-next").disabled = false;
    });
  });

  document.getElementById("ob-skip").onclick = () => {
    ob.answers[step.key] = 0;
    ob.notes[step.key] = "";
    ob.selected = null;
    ob.selectedNote = "";
    advanceOnboarding();
  };
  document.getElementById("ob-next").onclick = () => {
    ob.answers[step.key] = ob.selected ?? 0;
    ob.notes[step.key] = ob.selectedNote ?? "";
    ob.selected = null;
    ob.selectedNote = "";
    advanceOnboarding();
  };
}

function advanceOnboarding() {
  ob.step++;
  if (ob.step >= ONBOARDING_STEPS.length) completeOnboarding();
  else renderObStep();
}

async function completeOnboarding() {
  obProg.style.width = "100%";
  obBody.innerHTML = `
    <div class="ob-welcome">
      <div class="ob-icon ob-icon-done">✓</div>
      <h2>All set!</h2>
      <p>Your baseline has been saved. The tutor will adapt to your knowledge from the first question.</p>
    </div>`;
  obFooter.innerHTML = `<button class="ob-primary-btn" id="ob-finish">Start learning →</button>`;

  const body = { scores: ob.answers };
  if (state.knowledgeMode === "descriptions") body.notes = ob.notes;

  state.profile = await fetch(`/api/user/${encodeURIComponent(state.username)}/scores`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => r.json());

  renderDashboard();
  document.getElementById("ob-finish").onclick = () => { obModal.hidden = true; showWelcome(); };
}

function skipOnboarding() { obModal.hidden = true; showWelcome(); }

// ── Dashboard ──────────────────────────────────────────────────────────────
function renderDashboard() {
  topicsList.innerHTML = "";
  for (const [key, label] of Object.entries(TOPIC_NAMES)) {
    const item = document.createElement("div");
    item.className = "topic-item";
    item.dataset.topic = key;

    if (state.knowledgeMode === "descriptions") {
      renderTopicDescItem(item, key, label, state.profile.knowledgeNotes?.[key] ?? "");
    } else {
      renderTopicScoreItem(item, key, label, state.profile.knowledge[key] ?? 0);
    }

    topicsList.appendChild(item);
  }
}

function renderTopicScoreItem(item, key, label, score) {
  const pct = (score / 2) * 100;
  item.innerHTML = `
    <div class="topic-header">
      <span class="topic-name">${label}</span>
      <div class="topic-right">
        <span class="topic-score">${LEVEL_LABELS[score] ?? LEVEL_LABELS[0]}</span>
        <button class="edit-btn" title="Edit score">✏</button>
      </div>
    </div>
    <div class="bar-track">
      <div class="bar-fill" style="width:${pct}%"></div>
    </div>
    <div class="topic-editor">
      <input type="range" class="score-range" min="0" max="2" value="${score}" />
      <div class="editor-actions">
        <button class="save-btn">Save</button>
        <button class="cancel-btn">Cancel</button>
      </div>
    </div>`;

  const editBtn   = item.querySelector(".edit-btn");
  const range     = item.querySelector(".score-range");
  const scoreEl   = item.querySelector(".topic-score");
  const saveBtn   = item.querySelector(".save-btn");
  const cancelBtn = item.querySelector(".cancel-btn");

  editBtn.addEventListener("click", () => {
    item.classList.add("editing");
    range.value = state.profile.knowledge[key] ?? 0;
  });

  range.addEventListener("input", () => {
    scoreEl.textContent = LEVEL_LABELS[+range.value] ?? LEVEL_LABELS[0];
  });

  cancelBtn.addEventListener("click", () => {
    item.classList.remove("editing");
    const cur = state.profile.knowledge[key] ?? 0;
    scoreEl.textContent = LEVEL_LABELS[cur] ?? LEVEL_LABELS[0];
  });

  saveBtn.addEventListener("click", async () => {
    const newVal = Number(range.value);
    state.profile = await fetch(`/api/user/${encodeURIComponent(state.username)}/scores`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scores: { [key]: newVal } }),
    }).then((r) => r.json());
    item.classList.remove("editing");
    updateTopicScore(item, state.profile.knowledge[key]);
  });
}

function renderTopicDescItem(item, key, label, note) {
  item.innerHTML = `
    <div class="topic-header">
      <span class="topic-name">${label}</span>
      <button class="reset-btn" title="Clear knowledge record">↺</button>
    </div>
    <div class="topic-desc ${note ? "" : "empty"}">${note ? escapeHtml(note) : "No knowledge recorded yet"}</div>`;

  item.querySelector(".reset-btn").addEventListener("click", async () => {
    state.profile = await fetch(`/api/user/${encodeURIComponent(state.username)}/scores`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes: { [key]: "" } }),
    }).then((r) => r.json());
    updateTopicNote(item, "");
  });
}

function updateTopicScore(itemEl, score) {
  itemEl.querySelector(".bar-fill").style.width = `${(score / 2) * 100}%`;
  itemEl.querySelector(".topic-score").textContent = LEVEL_LABELS[score] ?? LEVEL_LABELS[0];
}

function updateTopicNote(itemEl, note) {
  const descEl = itemEl.querySelector(".topic-desc");
  if (note) {
    descEl.textContent = note;
    descEl.classList.remove("empty");
  } else {
    descEl.textContent = "No knowledge recorded yet";
    descEl.classList.add("empty");
  }
}

function refreshDashboard(profile) {
  state.profile = profile;
  for (const [key] of Object.entries(TOPIC_NAMES)) {
    const item = topicsList.querySelector(`[data-topic="${key}"]`);
    if (!item) continue;
    if (state.knowledgeMode === "descriptions") {
      updateTopicNote(item, profile.knowledgeNotes?.[key] ?? "");
    } else {
      updateTopicScore(item, profile.knowledge[key] ?? 0);
    }
  }
}

// ── Mode ───────────────────────────────────────────────────────────────────
function setMode(mode) {
  state.mode = mode;
  document.body.className = mode;
  modeBadge.textContent = mode === "in-drive" ? "IN-DRIVE" : "PRE-DRIVE";
  document.querySelectorAll(".mode-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.mode === mode);
  });
}

// ── Chat ───────────────────────────────────────────────────────────────────
function showWelcome() {
  clearMessages();
  const known = Object.entries(state.profile.knowledge)
    .filter(([, v]) => v > 0)
    .map(([k]) => TOPIC_NAMES[k]);

  const name = escapeHtml(state.username);
  let text;
  if (!known.length) {
    text = `Welcome, <strong>${name}</strong>! Let's start learning about your ADAS features.`;
  } else {
    text = `Welcome back, <strong>${name}</strong>! You already know: ${known.join(", ")}.`;
  }

  welcomeMsg.innerHTML = text;
  welcomeMsg.style.display = "";
}

function clearMessages() {
  [...messagesEl.children].forEach((c) => {
    if (c !== welcomeMsg) c.remove();
  });
  state.history = [];
  state.sessionId = crypto.randomUUID();
  welcomeMsg.style.display = "";
}

function appendMessage(role, html, raw = "") {
  welcomeMsg.style.display = "none";
  const wrap = document.createElement("div");
  wrap.className = `message ${role}`;
  wrap.innerHTML = `
    <div class="msg-role">${role === "user" ? escapeHtml(state.username?.toUpperCase() ?? "YOU") : "TUTOR"}</div>
    <div class="msg-bubble">${html}</div>`;
  messagesEl.appendChild(wrap);
  scrollToBottom();
  return wrap.querySelector(".msg-bubble");
}

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

async function sendMessage(text) {
  if (!text.trim() || state.streaming || !state.username) return;

  chatInput.value = "";
  chatInput.disabled = true;
  sendBtn.disabled = true;

  appendMessage("user", escapeHtml(text));

  const bubble = appendMessage("tutor", '<span class="cursor"></span>');
  state.streaming = true;

  let rawReply = "";

  try {
    const resp = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username:  state.username,
        question:  text,
        mode:      state.mode,
        history:   state.history.slice(-20),
        sessionId: state.sessionId,
      }),
    });

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const parts = buf.split("\n\n");
      buf = parts.pop();

      for (const part of parts) {
        if (!part.startsWith("data: ")) continue;
        const data = JSON.parse(part.slice(6));

        if (data.chunk !== undefined) {
          rawReply += data.chunk;
          bubble.innerHTML = escapeHtml(rawReply) + '<span class="cursor"></span>';
          scrollToBottom();
        }

        if (data.text_done) {
          bubble.innerHTML = renderMarkdown(rawReply);
          scrollToBottom();
          chatInput.disabled = false;
          sendBtn.disabled = false;
          chatInput.focus();
          if (state.ttsEnabled) speak(rawReply);
        }

        if (data.done) {
          state.history.push({ role: "human", content: text });
          state.history.push({ role: "ai",    content: rawReply });
          if (data.profile) refreshDashboard(data.profile);
        }

        if (data.error) {
          bubble.textContent = `Error: ${data.error}`;
        }
      }
    }
  } catch (e) {
    bubble.textContent = `Connection error: ${e.message}`;
  } finally {
    // Reset input state regardless of how the stream ended.
    chatInput.disabled = false;
    sendBtn.disabled = false;
    state.streaming = false;
  }
}

// ── Markdown renderer ──────────────────────────────────────────────────────
function renderMarkdown(text) {
  const lines = text.split("\n");
  const out = [];
  let inUl = false, inOl = false;

  const closeList = () => {
    if (inUl) { out.push("</ul>"); inUl = false; }
    if (inOl) { out.push("</ol>"); inOl = false; }
  };

  for (const raw of lines) {
    const ul = raw.match(/^\s*[-*+] (.+)/);
    const ol = raw.match(/^\s*\d+\. (.+)/);
    const h3 = raw.match(/^### (.+)/);
    const h2 = raw.match(/^## (.+)/);
    const h1 = raw.match(/^# (.+)/);

    if (ul) {
      if (inOl) { out.push("</ol>"); inOl = false; }
      if (!inUl) { out.push("<ul>"); inUl = true; }
      out.push(`<li>${inlineFormat(ul[1])}</li>`);
    } else if (ol) {
      if (inUl) { out.push("</ul>"); inUl = false; }
      if (!inOl) { out.push("<ol>"); inOl = true; }
      out.push(`<li>${inlineFormat(ol[1])}</li>`);
    } else {
      closeList();
      if      (h3)           out.push(`<h3>${inlineFormat(h3[1])}</h3>`);
      else if (h2)           out.push(`<h2>${inlineFormat(h2[1])}</h2>`);
      else if (h1)           out.push(`<h1>${inlineFormat(h1[1])}</h1>`);
      else if (raw.trim() === "") out.push("<br>");
      else                   out.push(`<p>${inlineFormat(raw)}</p>`);
    }
  }

  closeList();
  return out.join("");
}

function inlineFormat(text) {
  return text
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g,     "<em>$1</em>")
    .replace(/`(.+?)`/g,       "<code>$1</code>");
}

function escapeHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ── TTS ────────────────────────────────────────────────────────────────────
let currentAudio = null;

function cancelSpeech() {
  if (currentAudio) { currentAudio.pause(); currentAudio = null; }
  if (window.speechSynthesis) speechSynthesis.cancel();
}

function speakBrowser(clean) {
  if (!window.speechSynthesis) return;
  const u = new SpeechSynthesisUtterance(clean);
  u.rate = 0.95;
  speechSynthesis.speak(u);
}

async function speak(text) {
  cancelSpeech();
  const clean = text
    .replace(/#{1,6}\s+/g, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g,     "$1")
    .replace(/`(.+?)`/g,       "$1")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .trim();
  try {
    const resp = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!resp.ok) { speakBrowser(clean); return; }
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    currentAudio = new Audio(url);
    currentAudio.onended = () => { URL.revokeObjectURL(url); currentAudio = null; };
    await currentAudio.play();
  } catch {
    speakBrowser(clean);
  }
}

// ── Speech recognition ─────────────────────────────────────────────────────
// Mic input records with MediaRecorder and transcribes server-side via /api/stt.
const DEFAULT_PLACEHOLDER = "Ask about your ADAS features…";
const MAX_RECORDING_MS = 30_000;

let recorder = null;
let recorderTimeout = null;

function setupSpeech() {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    micBtn.style.display = "none";
  }
}

async function startRecording() {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    chatInput.placeholder = "Mic error: microphone access denied";
    return;
  }

  const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
    ? "audio/webm;codecs=opus"
    : "";
  recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks = [];

  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };

  recorder.onstop = async () => {
    clearTimeout(recorderTimeout);
    stream.getTracks().forEach((t) => t.stop());
    state.listening = false;
    micBtn.classList.remove("listening");
    const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
    recorder = null;
    await transcribe(blob);
  };

  recorder.start();
  state.listening = true;
  micBtn.classList.add("listening");
  chatInput.placeholder = "Listening… click the mic again to stop";
  recorderTimeout = setTimeout(() => { if (recorder?.state === "recording") recorder.stop(); }, MAX_RECORDING_MS);
}

async function transcribe(blob) {
  chatInput.placeholder = "Transcribing…";
  try {
    const base64 = await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload  = () => resolve(fr.result.split(",")[1]);
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(blob);
    });

    const resp = await fetch("/api/stt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audio: base64, mimeType: blob.type.split(";")[0] }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error ?? "transcription failed");

    chatInput.placeholder = DEFAULT_PLACEHOLDER;
    if (data.text) {
      chatInput.value = data.text;
      sendMessage(data.text);
    } else {
      chatInput.placeholder = "Didn't catch that — try again";
    }
  } catch (e) {
    chatInput.placeholder = `Mic error: ${e.message}`;
  }
}

function toggleListening() {
  if (recorder?.state === "recording") {
    recorder.stop();
  } else if (!state.listening) {
    startRecording();
  }
}

// ── Event listeners ────────────────────────────────────────────────────────
function setupEventListeners() {
  userInput.addEventListener("focus", () => showDropdown(userInput.value));
  userInput.addEventListener("input", () => showDropdown(userInput.value));
  userInput.addEventListener("blur",  () => setTimeout(hideDropdown, 150));
  userInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const val = userInput.value.trim();
      if (val) selectUser(val);
    }
    if (e.key === "Escape") hideDropdown();
  });

  document.querySelectorAll(".mode-btn").forEach((btn) => {
    btn.addEventListener("click", () => setMode(btn.dataset.mode));
  });

  sendBtn.addEventListener("click", () => sendMessage(chatInput.value));
  chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) sendMessage(chatInput.value);
  });

  micBtn.addEventListener("click", toggleListening);

  ttsBtn.addEventListener("click", () => {
    state.ttsEnabled = !state.ttsEnabled;
    ttsBtn.classList.toggle("active", !state.ttsEnabled);
    if (!state.ttsEnabled) cancelSpeech();
  });

  clearBtn.addEventListener("click", () => {
    if (state.profile) showWelcome();
    else clearMessages();
    cancelSpeech();
  });
}

init();
