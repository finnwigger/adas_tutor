// ── Query-rewrite test scenarios ───────────────────────────────────────────
// Evaluates core/query-rewrite.js: the trigger heuristic (needsRewrite) and
// the value of the LLM rewrite for retrieval (rewrite-vs-raw hit rate).
// Run with: npm run rag:test-rewrite   (see tests/rewrite-test.js)
//
// Classes:
//   referential      — follow-up can't retrieve on its own (pronouns/ellipsis);
//                      the rewrite should recover the expected doc(s).
//                      Metric: raw hit vs rewrite hit (delta = rewriter value).
//   self-contained   — trigger fires (pronoun/short) but the raw question
//                      already retrieves fine; the rewrite must NOT degrade
//                      retrieval (no-harm check).
//   negative         — long, self-contained questions that must NOT trigger
//                      the heuristic at all (false-positive check; no LLM call).
//
// History roles use the same convention as the chat API: "human" | "assistant".

export const REWRITE_SCENARIO_VERSION = "v1";

export const rewriteScenarios = [

  // ── Referential follow-ups ────────────────────────────────────────────────
  {
    id: "R1", class: "referential",
    name: "ACC — pronoun-only off-switch follow-up",
    history: [
      { role: "human",     content: "What is Active Cruise Control and what does it do?" },
      { role: "assistant", content: "Active Cruise Control maintains your set speed and the distance to the vehicle ahead, accelerating and braking automatically within system limits." },
    ],
    question: "And how do I switch it off again?",
    expectedDocs: ["Active_Cruise_Control_Knowledge_Base.txt"],
  },
  {
    id: "R2", class: "referential",
    name: "ACC — following-gap adjustment without naming the system",
    history: [
      { role: "human",     content: "Does Active Cruise Control keep a safe gap to the car in front?" },
      { role: "assistant", content: "Yes — it maintains a set distance to the vehicle ahead and brakes or accelerates automatically to hold it." },
    ],
    question: "Can I change how close it follows?",
    expectedDocs: ["Active_Cruise_Control_Knowledge_Base.txt"],
  },
  {
    id: "R3", class: "referential",
    name: "Limiter — 'that button' ellipsis",
    history: [
      { role: "human",     content: "How do I turn on the manual speed limiter?" },
      { role: "assistant", content: "Press the LIM button on the steering wheel — your current speed is accepted as the limit, or 20 mph if you're stationary." },
    ],
    question: "What was that button called again?",
    expectedDocs: ["Manual_Speed_Limiter_Knowledge_Base.txt"],
  },
  {
    id: "R4", class: "referential",
    name: "Limiter — kick-down follow-up with pronoun",
    history: [
      { role: "human",     content: "Will the manual speed limiter warn me when I reach the limit?" },
      { role: "assistant", content: "You get a visual and acoustic warning if you exceed the set limit unintentionally." },
    ],
    question: "And if I floor it, what happens then?",
    expectedDocs: ["Manual_Speed_Limiter_Knowledge_Base.txt"],
  },
  {
    id: "R5", class: "referential",
    name: "SLA — 'switch that off' follow-up",
    history: [
      { role: "human",     content: "Why does my car keep suggesting new speeds when the limit changes?" },
      { role: "assistant", content: "That's the Speed Limit Assistant — it detects speed-limit changes and suggests the new value, which you can apply with the SET button." },
    ],
    question: "Where do I switch that off?",
    expectedDocs: ["Speed_Limit_Assistant_Knowledge_Base.txt"],
  },
  {
    id: "R6", class: "referential",
    name: "Steering Assistant — sensors follow-up",
    history: [
      { role: "human",     content: "How does the Steering Assistant keep me in the lane through curves?" },
      { role: "assistant", content: "It executes supporting steering movements, orienting itself on lane markings or the vehicle ahead depending on your speed." },
    ],
    question: "Which sensors does it use for that?",
    expectedDocs: ["steering_assistant.txt"],
  },
  {
    id: "R7", class: "referential",
    name: "Steering Assistant — bare 'Why not?'",
    history: [
      { role: "human",     content: "Can I use the Steering Assistant on streets within the city?" },
      { role: "assistant", content: "No — within city limits is one of the situations where the system cannot be activated or effectively used." },
    ],
    question: "Why not?",
    expectedDocs: ["steering_assistant.txt"],
  },
  {
    id: "R8", class: "referential",
    name: "ETJA — speed cap follow-up",
    history: [
      { role: "human",     content: "What does the Extended Traffic Jam Assistant do?" },
      { role: "assistant", content: "It supports vehicle control in traffic jams on freeways, steering for you while you keep monitoring traffic." },
    ],
    question: "Up to what speed does it stay on?",
    expectedDocs: ["extended_traffic_jam_assistant.txt"],
  },
  {
    id: "R9", class: "referential",
    name: "ETJA — attention monitoring follow-up",
    history: [
      { role: "human",     content: "Do I still have to pay attention with the Extended Traffic Jam Assistant active?" },
      { role: "assistant", content: "Yes — you must watch traffic and be ready to take over steering and braking at any time." },
    ],
    question: "Does it actually check whether I'm watching?",
    expectedDocs: ["extended_traffic_jam_assistant.txt"],
  },
  {
    id: "R10", class: "referential",
    name: "ALC — abort mid-change follow-up",
    history: [
      { role: "human",     content: "How do I trigger an automatic lane change?" },
      { role: "assistant", content: "Check that traffic permits it, then briefly press the turn signal lever to the pressure point in the direction you want — the supporting steering movement follows shortly after." },
    ],
    question: "How do I abort it once it has started?",
    expectedDocs: ["automatic_lane_change_assistant.txt"],
  },
  {
    id: "R11", class: "referential",
    name: "LCAG — 'those suggestions' prerequisites",
    history: [
      { role: "human",     content: "Sometimes the car suggests a lane change to follow my navigation route. What is that?" },
      { role: "assistant", content: "That's Lane Change with Active Guidance — it prepares lane changes needed to reach your navigation destination and notifies you with a Check Control message." },
    ],
    question: "What has to be active for those suggestions to appear?",
    expectedDocs: ["lane_change_active_guidance.txt"],
  },
  {
    id: "R12", class: "referential",
    name: "ACC — resume stored speed follow-up",
    history: [
      { role: "human",     content: "My cruise control got interrupted when I braked. Is the set speed gone?" },
      { role: "assistant", content: "No — the stored speed is kept while the system stays on; the speedometer marking turns grey to show the interruption." },
    ],
    question: "How do I get it back to that speed?",
    expectedDocs: ["Active_Cruise_Control_Knowledge_Base.txt"],
  },
  {
    id: "R13", class: "referential",
    name: "Steering Assistant — 'the yellow ones' LED follow-up",
    history: [
      { role: "human",     content: "What are the LED lights above the steering wheel buttons for?" },
      { role: "assistant", content: "They give feedback for the Steering Assistant — they light up to warn you about the system's state." },
    ],
    question: "What do the yellow ones mean again?",
    expectedDocs: ["steering_assistant.txt"],
  },
  {
    id: "R14", class: "referential",
    name: "ACC vs limiter — 'which of them' comparison follow-up",
    history: [
      { role: "human",     content: "What's the difference between Active Cruise Control and the manual speed limiter?" },
      { role: "assistant", content: "ACC actively holds a speed and distance for you; the limiter only caps your maximum speed while you control the throttle yourself." },
    ],
    question: "Which of them works below 20 mph?",
    expectedDocs: ["Active_Cruise_Control_Knowledge_Base.txt", "Manual_Speed_Limiter_Knowledge_Base.txt"],
  },

  // ── Self-contained but trigger-firing (no-harm check) ────────────────────
  {
    id: "S1", class: "self-contained",
    name: "Steering Assistant — narrow lane (contains 'it', keywords present)",
    history: [
      { role: "human",     content: "Tell me about the Steering Assistant." },
      { role: "assistant", content: "The Steering Assistant helps keep the vehicle in the lane with supporting steering movements." },
    ],
    question: "How does the Steering Assistant handle it when the lane gets too narrow?",
    expectedDocs: ["steering_assistant.txt"],
  },
  {
    id: "S2", class: "self-contained",
    name: "ACC — cyclists (pronoun + full system name)",
    history: [
      { role: "human",     content: "Is Active Cruise Control safe in mixed traffic?" },
      { role: "assistant", content: "It has limits — it doesn't react to pedestrians, cross traffic, oncoming traffic, or red lights, so you must stay attentive." },
    ],
    question: "Can I trust it, the Active Cruise Control, around cyclists and pedestrians?",
    expectedDocs: ["Active_Cruise_Control_Knowledge_Base.txt"],
  },
  {
    id: "S3", class: "self-contained",
    name: "ETJA — short question with system name",
    history: [
      { role: "human",     content: "Does my car have a traffic jam feature?" },
      { role: "assistant", content: "Yes — the Extended Traffic Jam Assistant supports vehicle control in freeway traffic jams." },
    ],
    question: "Traffic Jam Assistant — how fast can it go?",
    expectedDocs: ["extended_traffic_jam_assistant.txt"],
  },
  {
    id: "S4", class: "self-contained",
    name: "Limiter — kick-down with system name (contains 'it')",
    history: [
      { role: "human",     content: "How strict is the manual speed limiter?" },
      { role: "assistant", content: "The vehicle won't exceed the set limit under normal acceleration, but you can override it intentionally." },
    ],
    question: "What does kick-down do to the speed limiter and when does it warn me?",
    expectedDocs: ["Manual_Speed_Limiter_Knowledge_Base.txt"],
  },

  // ── Negative controls — must NOT trigger the heuristic ───────────────────
  {
    id: "N1", class: "negative",
    name: "ACC — minimum speed, self-contained",
    history: [],
    question: "What is the minimum speed required for Active Cruise Control to operate?",
    expectedDocs: ["Active_Cruise_Control_Knowledge_Base.txt"],
  },
  {
    id: "N2", class: "negative",
    name: "ALC — enable path, self-contained",
    history: [],
    question: "How do I enable the Automatic Lane Change Assistant in the settings menu?",
    expectedDocs: ["automatic_lane_change_assistant.txt"],
  },
  {
    id: "N3", class: "negative",
    name: "Steering Assistant — interruption conditions, self-contained",
    history: [],
    question: "Which conditions interrupt the Steering Assistant automatically while driving on the highway?",
    expectedDocs: ["steering_assistant.txt"],
  },
  {
    id: "N4", class: "negative",
    name: "Limiter — downhill braking, self-contained",
    history: [],
    question: "Does the Manual Speed Limiter brake the car when driving downhill?",
    expectedDocs: ["Manual_Speed_Limiter_Knowledge_Base.txt"],
  },
  {
    id: "N5", class: "negative",
    name: "SLA — applying limits, self-contained",
    history: [],
    question: "How does the Speed Limit Assistant apply detected speed limits to cruise control?",
    expectedDocs: ["Speed_Limit_Assistant_Knowledge_Base.txt"],
  },
  {
    id: "N6", class: "negative",
    name: "ETJA — availability display, self-contained",
    history: [],
    question: "When does the Extended Traffic Jam Assistant become available in the instrument cluster?",
    expectedDocs: ["extended_traffic_jam_assistant.txt"],
  },
];
