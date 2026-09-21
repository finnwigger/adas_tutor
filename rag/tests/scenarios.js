// Each scenario:
//   question     — the query sent to the vector store (matches what api-server.js does)
//   history      — prior turns (NOT used for retrieval; shown for context only)
//   expectedDocs — filenames that must appear in filtered hits for the test to pass
//   note         — optional explanation shown in the report

export const scenarios = [

  // ── Tier 1: Direct retrieval ───────────────────────────────────────────────
  // Each question names the system explicitly. These should always pass.

  {
    name: "ACC — direct overview",
    history: [],
    question: "What is Active Cruise Control and how does it work?",
    expectedDocs: ["Active_Cruise_Control_Knowledge_Base.txt"],
  },
  {
    name: "Manual Speed Limiter — direct overview",
    history: [],
    question: "How do I use the manual speed limiter to set a maximum speed?",
    expectedDocs: ["Manual_Speed_Limiter_Knowledge_Base.txt"],
  },
  {
    name: "Speed Limit Assistant — direct overview",
    history: [],
    question: "What does the Speed Limit Assistant do and how does it suggest speeds?",
    expectedDocs: ["Speed_Limit_Assistant_Knowledge_Base.txt"],
  },
  {
    name: "Steering Assistant — direct overview",
    history: [],
    question: "How does the Steering Assistant help me stay in my lane?",
    expectedDocs: ["steering_assistant.txt"],
  },
  {
    name: "Traffic Jam Assistant — direct overview",
    history: [],
    question: "How does the Extended Traffic Jam Assistant work in stop-and-go traffic?",
    expectedDocs: ["extended_traffic_jam_assistant.txt"],
  },
  {
    name: "Automatic Lane Change — direct overview",
    history: [],
    question: "How do I trigger an automatic lane change using the turn signal?",
    expectedDocs: ["automatic_lane_change_assistant.txt"],
  },

  // ── Tier 2: Specific fact lookups ─────────────────────────────────────────
  // Tests whether the right chunk surfaces for a precise detail.

  {
    name: "ACC — minimum operating speed",
    history: [],
    question: "What is the minimum speed required for Active Cruise Control to operate?",
    expectedDocs: ["Active_Cruise_Control_Knowledge_Base.txt"],
    note: "Answer is 20 mph / 30 km/h — specific enough to probe chunk granularity",
  },
  {
    name: "Traffic Jam — maximum speed cap",
    history: [],
    question: "What is the maximum speed at which the traffic jam assistant can be active?",
    expectedDocs: ["extended_traffic_jam_assistant.txt"],
    note: "Answer is less than 40 mph / 60 km/h",
  },
  {
    name: "Lane Change — maximum speed cap",
    history: [],
    question: "What is the maximum speed allowed for an automatic lane change?",
    expectedDocs: ["automatic_lane_change_assistant.txt"],
    note: "Answer is approx 110 mph / 180 km/h",
  },
  {
    name: "Speed Limit Assistant — accepting a suggestion",
    history: [],
    question: "How do I accept a speed suggestion from the Speed Limit Assistant?",
    expectedDocs: ["Speed_Limit_Assistant_Knowledge_Base.txt"],
    note: "Answer involves pressing the SET button on the steering wheel",
  },
  {
    name: "ACC — motorcycle detection limit",
    history: [],
    question: "Can Active Cruise Control reliably detect motorcycles?",
    expectedDocs: ["Active_Cruise_Control_Knowledge_Base.txt"],
    note: "Answer is no — mentioned explicitly in system limits section",
  },
  {
    name: "Manual Speed Limiter — downhill behaviour",
    history: [],
    question: "Will the speed limiter brake the car automatically if I go downhill?",
    expectedDocs: ["Manual_Speed_Limiter_Knowledge_Base.txt"],
    note: "Answer is no — the vehicle is not actively braked on downhill slopes",
  },

  // ── Tier 3: Cross-topic queries ────────────────────────────────────────────
  // Questions that span multiple docs. Tests whether both relevant chunks surface.

  {
    name: "Lane Change — requirements (overlaps with Steering)",
    history: [],
    question: "What conditions must be met before an automatic lane change can happen?",
    expectedDocs: [
      "automatic_lane_change_assistant.txt",
      "steering_assistant.txt",
    ],
    note: "Lane change functional requirements explicitly reference Steering Assistant requirements",
  },
  {
    name: "ACC + Lane Change — system interaction",
    history: [],
    question: "Can I change lanes automatically while Active Cruise Control is running?",
    expectedDocs: [
      "automatic_lane_change_assistant.txt",
      "Active_Cruise_Control_Knowledge_Base.txt",
    ],
    note: "Lane change with active guidance requires ACC to be active",
  },
  {
    name: "Sensors — cross-system query",
    history: [],
    question: "Which driver assistance systems use the front radar sensor?",
    expectedDocs: [
      "Active_Cruise_Control_Knowledge_Base.txt",
      "steering_assistant.txt",
    ],
    note: "Both ACC and Steering list the front radar as a sensor",
  },

  // ── Tier 4: Ambiguous queries ──────────────────────────────────────────────
  // Queries where two docs are plausible — tests whether the primary doc wins.

  {
    name: "Ambiguous — set a speed limit",
    history: [],
    question: "How do I set a speed limit in my car?",
    expectedDocs: ["Manual_Speed_Limiter_Knowledge_Base.txt"],
    note: "Speed Limit Assistant may also surface — both relate to speed limits but different mechanisms",
  },
  {
    name: "Ambiguous — bad weather",
    history: [],
    question: "What happens if I use the system in heavy rain or poor visibility?",
    expectedDocs: [
      "Active_Cruise_Control_Knowledge_Base.txt",
      "steering_assistant.txt",
    ],
    note: "ACC lists rain as an automatic interruption trigger; Steering mentions weather limits",
  },

  // ── Tier 4b: Loose behavioral descriptions (no feature name) ─────────────
  // Driver describes what the car is doing without naming the system.
  // Tests whether the correct doc surfaces from symptom language.

  {
    name: "Loose — car slows itself in traffic",
    history: [],
    question: "My car keeps slowing down and speeding up by itself when I'm behind another car — what is doing that?",
    expectedDocs: ["Active_Cruise_Control_Knowledge_Base.txt"],
    note: "Describes ACC behaviour without naming it",
  },
  {
    name: "Loose — steering resists at lane markings",
    history: [],
    question: "The steering wheel pushes back when I drift towards the white lines — is that a fault or a feature?",
    expectedDocs: ["steering_assistant.txt"],
    note: "Describes lane-keeping haptic feedback without naming the system",
  },
  {
    name: "Loose — speed sign shown but car did not change speed",
    history: [],
    question: "A new speed limit appeared on my dashboard but the car didn't slow down — do I have to confirm it somehow?",
    expectedDocs: ["Speed_Limit_Assistant_Knowledge_Base.txt"],
    note: "Describes SLA suggestion behaviour without naming the system",
  },
  {
    name: "Loose — car stopped and restarted alone in queue",
    history: [],
    question: "In a motorway queue the car came to a full stop and then pulled away on its own — which feature does that?",
    expectedDocs: ["extended_traffic_jam_assistant.txt"],
    note: "Stop-and-go behaviour described without naming TJA",
  },
  {
    name: "Loose — car moved lanes when I indicated",
    history: [],
    question: "I put my right indicator on and the car just moved over by itself — I didn't steer at all. What happened?",
    expectedDocs: ["automatic_lane_change_assistant.txt"],
    note: "Automatic lane change described from driver's surprise perspective",
  },
  {
    name: "Loose — want to cap my speed without using cruise",
    history: [],
    question: "Is there a way to stop the car going faster than 70 without it controlling the throttle automatically?",
    expectedDocs: ["Manual_Speed_Limiter_Knowledge_Base.txt"],
    note: "Manual speed limiter described by desired outcome, contrasted with ACC",
  },

  // ── Tier 4c: Edge-case and failure descriptions ────────────────────────────
  // Describes something going wrong or behaving unexpectedly.

  {
    name: "Edge — system cut out in tunnel",
    history: [],
    question: "The driving assistance switched off when I went through a tunnel — is that supposed to happen?",
    expectedDocs: [
      "Active_Cruise_Control_Knowledge_Base.txt",
      "steering_assistant.txt",
    ],
    note: "Sensor interruption in tunnels covered by both ACC and Steering docs",
  },
  {
    name: "Edge — following distance inconsistent",
    history: [],
    question: "Sometimes my car leaves a big gap to the vehicle ahead and sometimes a small one — why does the distance change?",
    expectedDocs: ["Active_Cruise_Control_Knowledge_Base.txt"],
    note: "Gap presets / following distance settings in ACC doc",
  },
  {
    name: "Edge — speed suggestion disappeared after roadworks",
    history: [],
    question: "The speed limit shown by the assistant vanished when I left the roadworks zone — why did it disappear?",
    expectedDocs: ["Speed_Limit_Assistant_Knowledge_Base.txt"],
    note: "SLA sign-reading and display conditions",
  },
  {
    name: "Edge — car fights steering on tight bend",
    history: [],
    question: "Going around a sharp bend the system seemed to fight against me when I turned — should I have switched it off?",
    expectedDocs: ["steering_assistant.txt"],
    note: "Steering assistant limitations on tight curves",
  },

  // ── Tier 4d: Safety and override questions ─────────────────────────────────
  // Driver asks what happens when they intervene or override.

  {
    name: "Override — braking while ACC active",
    history: [],
    question: "If I press the brake myself while the car is following traffic, does the system take over again when I let go?",
    expectedDocs: ["Active_Cruise_Control_Knowledge_Base.txt"],
    note: "Driver override and resumption behaviour in ACC doc",
  },
  {
    name: "Override — lane change blocked by vehicle alongside",
    history: [],
    question: "What if there is already a car next to me when the automatic lane change tries to activate?",
    expectedDocs: ["automatic_lane_change_assistant.txt"],
    note: "Safety checks and abort conditions for ALC",
  },
  {
    name: "Safety — using ACC in heavy rain",
    history: [],
    question: "Is it safe to use the cruise system in heavy rain, or should I turn it off?",
    expectedDocs: ["Active_Cruise_Control_Knowledge_Base.txt"],
    note: "ACC weather limitations and radar degradation",
  },
  {
    name: "Safety — stationary vehicle detection",
    history: [],
    question: "Will the car brake automatically for a stationary vehicle in the road, or only for moving traffic?",
    expectedDocs: ["Active_Cruise_Control_Knowledge_Base.txt"],
    note: "ACC stationary object detection limits",
  },

  // ── Tier 5: Pronoun follow-up failures ────────────────────────────────────
  // Questions that only make sense with history. Since history is NOT used for
  // retrieval, these expose the limitation: the vector store can't resolve "it".

  {
    name: "Pronoun follow-up — 'turn it off' after ACC discussion",
    history: [
      {
        role: "human",
        content: "Tell me about Active Cruise Control",
      },
      {
        role: "ai",
        content: "Active Cruise Control maintains your desired speed and a safe following distance. It can brake and accelerate automatically, including in stop-and-go traffic.",
      },
    ],
    question: "How do I turn it off?",
    expectedDocs: ["Active_Cruise_Control_Knowledge_Base.txt"],
    note: "History is not used for retrieval — 'it' is unresolved. Multiple docs have TURNING OFF sections so the wrong one may rank highest",
  },
  {
    name: "Pronoun follow-up — warning after speed limiter discussion",
    history: [
      {
        role: "human",
        content: "Explain the manual speed limiter",
      },
      {
        role: "ai",
        content: "The manual speed limiter prevents the car from exceeding a speed you set. You press the LIM button and the current speed is stored as the limit.",
      },
    ],
    question: "What warning do I get if I accidentally go over it?",
    expectedDocs: ["Manual_Speed_Limiter_Knowledge_Base.txt"],
    note: "'It' refers to the speed limit set by the limiter — without history, retrieval may surface unrelated docs",
  },
  {
    name: "Pronoun follow-up — availability after traffic jam discussion",
    history: [
      {
        role: "human",
        content: "Does the traffic jam assistant work everywhere?",
      },
      {
        role: "ai",
        content: "The Extended Traffic Jam Assistant is only available on certain road types, like freeways, and only at speeds below around 40 mph.",
      },
    ],
    question: "What if I'm on a normal road, will it still activate?",
    expectedDocs: ["extended_traffic_jam_assistant.txt"],
    note: "'It' and 'normal road' are both underspecified without history — retrieval may miss the traffic jam doc entirely",
  },

  // ── Tier 5b: Multi-turn histories with complex/ambiguous references ──────
  // Harder than plain pronoun follow-ups: topic drift, recency traps, chained
  // references across multiple systems, and references to a described
  // behaviour rather than a named feature — all invisible to retrieval since
  // only the final question (not the history) is embedded for search.

  {
    name: "Recency trap — returning to an earlier topic after a tangent",
    history: [
      {
        role: "human",
        content: "How does Active Cruise Control decide how much space to leave to the car in front?",
      },
      {
        role: "ai",
        content: "Active Cruise Control lets you choose from several following-distance stages, and it automatically keeps that gap by braking and accelerating for you.",
      },
      {
        role: "human",
        content: "Quick side question — why did my steering wheel just vibrate for a second?",
      },
      {
        role: "ai",
        content: "That's the Steering Assistant's lane-departure warning — a yellow flashing steering-wheel symbol appears and the wheel vibrates when you drift over a lane marking without indicating.",
      },
      {
        role: "human",
        content: "Ah, good to know.",
      },
    ],
    question: "Anyway, back to what we were discussing before — how do I change it?",
    expectedDocs: ["Active_Cruise_Control_Knowledge_Base.txt"],
    note: "'It' should resolve to the ACC following distance from two turns earlier, not the steering vibration from the most recent turn — a recency trap. Retrieval sees only the final sentence and has no way to know the conversation looped back",
  },
  {
    name: "Genuinely ambiguous 'it' between two speed-control systems",
    history: [
      {
        role: "human",
        content: "What's the difference between Active Cruise Control and the manual speed limiter?",
      },
      {
        role: "ai",
        content: "Active Cruise Control actively manages your speed and following distance for you, braking and accelerating automatically. The manual speed limiter is passive — it just stops you from exceeding a speed you set with the LIM button, and you still control the pedals yourself.",
      },
    ],
    question: "Right — so how do I turn it off once I'm done with it?",
    expectedDocs: ["Active_Cruise_Control_Knowledge_Base.txt", "Manual_Speed_Limiter_Knowledge_Base.txt"],
    note: "'It' genuinely could refer to either system just explained — there is no single correct antecedent. A grounded tutor would ask which one the student means; either doc is a defensible retrieval target, but a system confident in just one is masking the ambiguity rather than resolving it",
  },
  {
    name: "Event-level anaphora — referring to a described behaviour, not a system name",
    history: [
      {
        role: "human",
        content: "Sometimes when I'm driving on the highway with cruise control on, the car suddenly brakes on its own even though nothing is obviously in the way. It's a bit unsettling.",
      },
      {
        role: "ai",
        content: "That's most likely Active Cruise Control reacting to its sensors — its cameras and front radar can pick up a stationary vehicle, a car merging in, or a large speed difference to traffic ahead and brake earlier or harder than you'd expect as a precaution.",
      },
    ],
    question: "Is that something I should report to a dealer, or does it just do that sometimes and I have to live with it?",
    expectedDocs: ["Active_Cruise_Control_Knowledge_Base.txt"],
    note: "Zero ADAS vocabulary in the final question — 'that' and 'it' both refer back to a described behaviour (unexpected braking) rather than any named feature. This is event-level anaphora, a step harder than resolving a pronoun to an entity name",
  },
  {
    name: "Pure conversational deixis — 'the one we started with' after a long detour",
    history: [
      {
        role: "human",
        content: "Does the Extended Traffic Jam Assistant work on any road, or only certain ones?",
      },
      {
        role: "ai",
        content: "It's only available on certain street types, like freeways, and only below about 40 mph — so it won't help on most ordinary roads.",
      },
      {
        role: "human",
        content: "Makes sense. Totally different question — does the speed limiter let the car coast faster going downhill, or does it actively brake to hold the limit?",
      },
      {
        role: "ai",
        content: "The manual speed limiter only intervenes on the throttle side — it won't actively brake for you, so on a steep downhill the car can still drift over your set limit and you'd need to brake yourself.",
      },
      {
        role: "human",
        content: "Got it. So, going back — would it actually activate for me on my daily commute?",
      },
      {
        role: "ai",
        content: "Could you clarify which system you mean — the traffic jam assistant or the speed limiter?",
      },
    ],
    question: "The one we started with — sorry, I should've said that the first time.",
    expectedDocs: ["extended_traffic_jam_assistant.txt"],
    note: "The final message contains zero topical vocabulary at all — purely conversational deixis ('the one we started with') pointing four turns back, even past a clarifying question. Near-impossible for history-blind retrieval; demonstrates the hard ceiling of this architecture",
  },
  {
    name: "Chained references across two systems in one follow-up",
    history: [
      {
        role: "human",
        content: "If I have Active Cruise Control on, can the car also steer itself to stay centred in the lane?",
      },
      {
        role: "ai",
        content: "Yes — combined with the Steering Assistant, the car can manage both speed and lane centring together. With Active Cruise Control active, that combination also satisfies the requirements for the Automatic Lane Change function, which can change lanes for you on the highway.",
      },
    ],
    question: "Oh nice — and that one needs me to use the indicator first, right? Or does it just go ahead and do it on its own once it decides a lane change makes sense?",
    expectedDocs: ["automatic_lane_change_assistant.txt"],
    note: "'That one' chains back through two named systems (Steering Assistant, then Automatic Lane Change) introduced only in passing — the question itself names neither. Retrieval has to land on the lane-change doc using only indicator/automatic-activation language, with no system name to anchor on",
  },

  // ── Tier 6: Informal everyday language (no ADAS vocabulary) ──────────────
  // Ordinary drivers describing what they experience, using no technical terms.

  {
    name: "Informal — car brakes itself near traffic",
    history: [],
    question: "my car brakes on its own when I get too close to the car in front, is that normal?",
    expectedDocs: ["Active_Cruise_Control_Knowledge_Base.txt"],
    note: "ACC described purely as unexpected braking behaviour, no feature name",
  },
  {
    name: "Informal — number on dash after passing sign",
    history: [],
    question: "there's a number that keeps popping up on my dashboard every time I drive past a speed sign",
    expectedDocs: ["Speed_Limit_Assistant_Knowledge_Base.txt"],
    note: "SLA sign-reading described from display observation, no feature name",
  },
  {
    name: "Informal — car won't let me go over the limit",
    history: [],
    question: "why won't my car let me accelerate past the speed limit, it just resists",
    expectedDocs: ["Speed_Limit_Assistant_Knowledge_Base.txt"],
    note: "SLA enforcement mode described without naming the system",
  },
  {
    name: "Informal — steering nudges back to centre",
    history: [],
    question: "something nudges my steering wheel back towards the middle whenever I start drifting",
    expectedDocs: ["steering_assistant.txt"],
    note: "Haptic lane-keep described with no system name",
  },
  {
    name: "Informal — car stopped when traffic stopped",
    history: [],
    question: "the car in front stopped dead and my car stopped automatically too without me touching anything",
    expectedDocs: ["extended_traffic_jam_assistant.txt"],
    note: "TJA stop behaviour with everyday phrasing — ACC may rank higher as it also handles stops",
  },
  {
    name: "Informal — want a top speed without autopilot",
    history: [],
    question: "is there a way to set a top speed so I can't accidentally go over it, but without it controlling the throttle automatically",
    expectedDocs: ["Manual_Speed_Limiter_Knowledge_Base.txt"],
    note: "Manual limiter described by desired outcome vs ACC distinction",
  },
  {
    name: "Informal — car crept over set speed downhill",
    history: [],
    question: "I set a top speed but the car still crept over it going downhill, is that a bug or is it supposed to do that?",
    expectedDocs: ["Manual_Speed_Limiter_Knowledge_Base.txt"],
    note: "Downhill override behaviour of manual limiter in everyday terms",
  },

  // ── Tier 7: Very casual / slang ───────────────────────────────────────────
  // Text-message style, contractions, filler words, colloquial phrasing.

  {
    name: "Slang — car drives itself on motorway",
    history: [],
    question: "my car literally just drives itself behind lorries on the motorway, what even is that lol",
    expectedDocs: ["Active_Cruise_Control_Knowledge_Base.txt"],
    note: "ACC described with slang and surprise, no technical vocabulary",
  },
  {
    name: "Slang — indicator made car change lane",
    history: [],
    question: "I barely tapped the indicator and the car just swooped into the next lane by itself??",
    expectedDocs: ["automatic_lane_change_assistant.txt"],
    note: "ALC trigger described colloquially with disbelief",
  },
  {
    name: "Slang — beep and nudge near white lines",
    history: [],
    question: "there's like a beep and the wheel kind of pushes back when I drift near the white lines on the road",
    expectedDocs: ["steering_assistant.txt"],
    note: "Steering lane alert described casually with filler language",
  },
  {
    name: "Slang — dash reads electronic signs",
    history: [],
    question: "the car seems to read those big electronic speed signs and shows it on the dash, how does it know",
    expectedDocs: ["Speed_Limit_Assistant_Knowledge_Base.txt"],
    note: "SLA camera/sign reading described informally",
  },
  {
    name: "Slang — car keeps me in the middle of the lane",
    history: [],
    question: "does my car have something that sort of keeps it in the middle of the lane so I don't have to steer as much",
    expectedDocs: ["steering_assistant.txt"],
    note: "Lane centring described casually as a query rather than observation",
  },

  // ── Tier 8: Non-native / broken English ───────────────────────────────────
  // Grammatically incorrect, missing articles, incorrect tense, direct translation
  // patterns — as a non-native speaker would type into a chat box.

  {
    name: "Broken English — car slow behind other car",
    history: [],
    question: "car slow by itself behind other car, how this work?",
    expectedDocs: ["Active_Cruise_Control_Knowledge_Base.txt"],
    note: "ACC described in minimal broken English, no subject or article",
  },
  {
    name: "Broken English — set limit so car no go faster",
    history: [],
    question: "I want put limit so car no go more fast than I want, how I do this?",
    expectedDocs: ["Manual_Speed_Limiter_Knowledge_Base.txt"],
    note: "Manual limiter requested in broken English with literal phrasing",
  },
  {
    name: "Broken English — sign on road car see automatic",
    history: [],
    question: "car see speed sign on road by itself automatic, what is this function?",
    expectedDocs: ["Speed_Limit_Assistant_Knowledge_Base.txt"],
    note: "SLA described in very terse broken English — semantic distance from doc vocabulary may be large",
  },
  {
    name: "Broken English — queue car stop and go alone",
    history: [],
    question: "in traffic queue my car stop full and then go again by self, is normal?",
    expectedDocs: ["extended_traffic_jam_assistant.txt"],
    note: "TJA stop-and-go in broken English — same vocabulary gap as Tier 4b failure, compounded by grammar",
  },
  {
    name: "Broken English — indicator car go other lane",
    history: [],
    question: "when I put indicator car go other lane by self, what this feature called?",
    expectedDocs: ["automatic_lane_change_assistant.txt"],
    note: "ALC described in broken English asking for the feature name",
  },
  {
    name: "Broken English — car know stay middle road",
    history: [],
    question: "how car know to stay middle of road, is camera or what?",
    expectedDocs: ["steering_assistant.txt"],
    note: "Steering lane centring in very terse broken English — 'middle of road' may not match doc vocabulary",
  },
  {
    name: "Broken English — what is LIM button mean",
    history: [],
    question: "on dashboard there is button say LIM, what this mean and how use?",
    expectedDocs: ["Manual_Speed_Limiter_Knowledge_Base.txt"],
    note: "User discovered the LIM button but has no idea what it does",
  },
  {
    name: "Broken English — car follow car in front itself",
    history: [],
    question: "my car following other car in front by itself, I not touch pedal, is ok or problem?",
    expectedDocs: ["Active_Cruise_Control_Knowledge_Base.txt"],
    note: "ACC described with non-native grammar and genuine uncertainty whether it's a fault",
  },

  // ── Tier 9: Completely unfamiliar — doesn't know ADAS exists ──────────────
  // Users who have never heard of driver assistance and describe the car as
  // malfunctioning or magical. No technical vocabulary, no feature awareness.

  {
    name: "Unfamiliar — car has a mind of its own in traffic",
    history: [],
    question: "my car seems to have a mind of its own when I'm on the motorway, it slows down and speeds up by itself following the car in front",
    expectedDocs: ["Active_Cruise_Control_Knowledge_Base.txt"],
    note: "User has no idea ACC exists, describes it as the car behaving strangely",
  },
  {
    name: "Unfamiliar — something is messing with my steering",
    history: [],
    question: "something keeps messing with my steering wheel, it kind of fights me or corrects me, is something broken?",
    expectedDocs: ["steering_assistant.txt"],
    note: "Steering assistant described as a possible fault by a user unaware it exists",
  },
  {
    name: "Unfamiliar — car won't speed up past a number",
    history: [],
    question: "my car just refuses to go faster than a certain number no matter how hard I press the accelerator, nothing seems broken but it just won't go",
    expectedDocs: [
      "Speed_Limit_Assistant_Knowledge_Base.txt",
      "Manual_Speed_Limiter_Knowledge_Base.txt",
    ],
    note: "Could be either SLA in enforcement mode or manual limiter — user has zero context",
  },
  {
    name: "Unfamiliar — car randomly changed lanes",
    history: [],
    question: "I think my car might be broken, it just moved into the other lane on its own while I was on the motorway, I was very alarmed",
    expectedDocs: ["automatic_lane_change_assistant.txt"],
    note: "ALC described as a suspected malfunction by a startled driver",
  },
  {
    name: "Unfamiliar — confused about gap to car in front",
    history: [],
    question: "there seems to be some kind of invisible rope between my car and the one in front, it keeps the same distance no matter what I do",
    expectedDocs: ["Active_Cruise_Control_Knowledge_Base.txt"],
    note: "ACC following distance described metaphorically with no ADAS awareness",
  },
];
