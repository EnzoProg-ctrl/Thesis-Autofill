/* ============================================================
   XLM-RoBERTa Classification Client
   Calls the inference service for CATEGORY; keeps the existing
   keyword logic for priority and language.
   ============================================================ */

import { analyzeText as analyzeTextKeyword, scorePriority, detectLanguage } from './keyword-classifier.js';

/* Inference service (RobertaTraining/serve.py).

   127.0.0.1 resolves to the TENANT'S OWN DEVICE, not to your server. Left as
   the default only because it is right for local development; on a phone the
   fetch fails and every report silently falls through to the keyword scorer,
   with the app looking entirely healthy while doing so.

   For a real deployment set this to the machine running serve.py — a LAN
   address is fine, the model does not need a GPU to serve. Either edit the
   fallback below or define it before this module loads:

       <script>window.FIRS_API_BASE = 'http://192.168.1.50:8000';</script>

   Verify with checkHealth() after changing it; a silent fallback is the one
   failure mode this system will not announce. */
const API_BASE = (typeof window !== 'undefined' && window.FIRS_API_BASE)
  || 'http://127.0.0.1:8000';

/* A tenant reporting a burst pipe must never be blocked by a model service.
   If inference has not answered in this long, give up and use the keyword
   classifier.

   Raised from 8s to 15s on 2026-08-19. A measured COLD request against the
   deployed Space took 7694 ms — 306 ms inside the old limit. Warm requests
   settle at ~1 s (five consecutive: 1.03, 1.06, 1.08, 1.05, 1.05), so this
   ceiling is only ever reached by the first report after an idle period,
   which is exactly the request that must not be dropped: 51 tenants hitting
   a Space that idles between bursts means someone gets the cold one.

   The trade is asymmetric. Waiting another few seconds costs a tenant who is
   already watching a spinner very little. Timing out costs a silent downgrade
   to the keyword scorer, which is markedly worse on Taglish and announces
   nothing — the report just gets a worse answer and looks identical on
   screen. Better late and right than prompt and wrong.

   All 26 reports in the database to date read ai_priority_source = 'model',
   so this has never actually fired in production. That is a margin worth
   keeping, not evidence the limit was generous. */
const TIMEOUT_MS = 15000;

/* Category ids the model can emit. As of 2026-08-17 this matches the app's
   CATEGORIES list exactly (app-data.js) — the 'elevator' category, which the
   model was never trained on, was removed from the app rather than left as a
   choice the AI could never return. Nothing is unsupported now; keep the empty
   list so the check has somewhere to grow if a class is ever added to the app
   ahead of the model. */
export const MODEL_CATEGORY_IDS = [
  'electrical', 'plumbing', 'hvac', 'structural',
  'fire_safety', 'housekeeping', 'other',
];
export const UNSUPPORTED_CATEGORY_IDS = [];


/* ============================================================
   Deterministic keyword safety floor

   Priority accuracy is 0.7848, and 0.34% of reports are severe
   underestimates. Most priority errors are harmless; a fire or an
   electrocution routed as Low is not. This floor removes that class of error
   for the words that name it, without touching the model.

   Contract: matching text can never be routed below High. The model may
   escalate above the floor — Critical stays Critical — and is never pulled
   down.

   It runs CLIENT-SIDE on every path, including the keyword fallback used when
   the inference service is unreachable. That is deliberate: the service being
   down is exactly when a burst-pipe report is most likely to be misrouted, and
   a safety guarantee that disappears with the network is not a guarantee. The
   server applies the same floor independently (RobertaTraining/serve.py), so
   an old client against a new server and a new client against an old server
   both still get it. Applying it twice is harmless — the floor is idempotent.

   The floor is not a classifier. Its bias is deliberate: a false High costs a
   wasted call-out, a false Low can cost someone their life. It does NOT parse
   negation, so "wala pang usok" ("no smoke yet") trips it. That is the correct
   trade.

   MIRRORED FROM RobertaTraining/serve.py — the two lists must stay identical.
   RobertaTraining/test_safety_floor.py parses both files and fails on drift.
   ============================================================ */

const PRIORITY_RANK = { low: 0, medium: 1, high: 2, critical: 3 };

const SAFETY_FLOOR_LEVEL = 'high';
/* Bottom of the app's High band (keyword-classifier.js scorePriority bands:
   >=80 critical, >=60 high, >=40 medium). The floor lifts to exactly this and not
   to the 70 band centre — the claim is "at least High", and 70 would assert a
   confidence the floor has not earned. */
const SAFETY_FLOOR_SCORE = 60;

/* Tagalog infixes and reduplicates around the stem — "usok" becomes
   "umuusok", "sunog" becomes "nasusunog" — so a word-boundary match would miss
   exactly the phrasings tenants actually write. Matched as SUBSTRINGS. */
const DANGER_SUBSTRINGS = [
  'sunog',        // sunog, nasusunog, nasunog, sinusunog, AMOY SUNOG
  'usok',         // usok, umuusok, mausok, inuusukan
  'apoy',         // apoy, umaapoy, nag-aapoy — added 2026-08-13, see below
  'nakuryente',   // nakuryente, na-kuryente, nakuryenteng
  'nakoryente',   // the same word as spelled by half the corpus
  'naipit',       // naipit, na-ipit
  'naiipit',      // naiipit, nai-ipit — not a substring of "naipit"
];

/* "apoy" (flame) was added after the 7-class evaluation surfaced the only
   genuine severe underestimate in the test set — "May apoy na maliit na
   lumalabas pag sinasaksak namin ung kettle" (a small flame comes out when we
   plug in our kettle), true High, predicted Low. It is the Tagalog noun and
   carries none of the ambiguity that kept English "fire" out of this list:
   there is no apoy equivalent of "fire exit" or "fire drill". Verified across
   the corpus first — 46 rows, all Electrical, none Low or Medium. */

/* Bare "kuryente" is deliberately absent: it just means "electricity", and
   "walang kuryente" (no power) is an ordinary Medium report. Only the na-
   form, meaning a person was shocked, is a danger word. "fire" is absent for
   the same reason — "fire exit", "fire drill" and "fire extinguisher" are
   routine Fire Safety vocabulary. */

/* English terms, matched at word boundaries so "sparkling" does not fire. */
const DANGER_WORDS = [
  ['trapped', /\btrapped\b/],
  ['smoke', /\bsmok(?:e|es|ing|y)\b/],
  ['sparks', /\bspark(?:s|ed|ing)?\b/],
];

/* Device names, not events. "Please test our smoke detector" is a scheduled
   compliance chore, not a fire; flooring it to High would push routine work
   into the emergency queue and train staff to ignore the flag. Blanked out
   BEFORE matching, so "the smoke detector is going off and the corridor is
   full of smoke" still trips on the second "smoke". */
const NOT_DANGER_RE =
  /\bsmoke[\s-]?(?:detector|detectors|alarm|alarms|sensor|sensors)\b|\bno[\s-]smoking\b|\bsmoking[\s-]area\b|\bsmoke[\s-]free\b/g;


/**
 * Danger terms present in the text, in a stable order. Empty array if none.
 * @param {string} text
 * @returns {string[]}
 */
export function safetyFloorTerms(text) {
  const haystack = String(text).toLowerCase().replace(NOT_DANGER_RE, ' ');
  /* Taglish writes the same word with and without a hyphen ("na-kuryente").
     Only the substring pass gets the de-hyphenated form: stripping hyphens
     would DESTROY a word-boundary match, turning "nag-spark" into
     "nagspark". */
  const dehyphenated = haystack.replace(/-/g, '');

  const hits = DANGER_SUBSTRINGS.filter(
    (t) => haystack.includes(t) || dehyphenated.includes(t));
  for (const [name, re] of DANGER_WORDS) {
    if (re.test(haystack)) hits.push(name);
  }
  return hits;
}


/**
 * Raise a priority to at least High when a danger term is present.
 * Never lowers one. Idempotent.
 *
 * @param {string} text
 * @param {number} priorityScore
 * @param {string} priorityLevel  'low' | 'medium' | 'high' | 'critical'
 * @returns {{priorityScore: number, priorityLevel: string, override: Object}}
 */
export function applySafetyFloor(text, priorityScore, priorityLevel) {
  const matchedTerms = safetyFloorTerms(text);
  const override = { applied: false, matchedTerms, floor: SAFETY_FLOOR_LEVEL };
  if (matchedTerms.length === 0) {
    return { priorityScore, priorityLevel, override };
  }

  /* Level and score are floored independently. The model's score is a
     probability-weighted mean, so a report whose top class is High can still
     score 55 when the distribution has a long tail into Low — and the app
     badges from the SCORE. Checking only the level would leave that report
     displaying as Medium. */
  const rank = PRIORITY_RANK[priorityLevel] ?? 0;
  const flooredLevel =
    rank >= PRIORITY_RANK[SAFETY_FLOOR_LEVEL] ? priorityLevel : SAFETY_FLOOR_LEVEL;
  const flooredScore = Math.max(priorityScore, SAFETY_FLOOR_SCORE);

  if (flooredLevel === priorityLevel && flooredScore === priorityScore) {
    return { priorityScore, priorityLevel, override };   // already at/above
  }

  Object.assign(override, {
    applied: true,
    modelPriorityLevel: priorityLevel,
    modelPriorityScore: priorityScore,
  });
  return { priorityScore: flooredScore, priorityLevel: flooredLevel, override };
}


/**
 * Classify a report. Signature and return shape match keyword-classifier.analyzeText,
 * so this is a drop-in replacement.
 *
 * @param {string} text
 * @param {string} userCategory    Tenant's own category selection (a hint only)
 * @param {string} selfAssessment  'low' | 'medium' | 'urgent'
 * @returns {Promise<Object>} { category, confidence, priorityScore, priorityLevel,
 *                              language, reasoning, keywords, allScores, source }
 */
export async function analyzeText(text, userCategory = '', selfAssessment = 'medium') {
  let prediction;
  try {
    prediction = await callInferenceService(text, userCategory);
  } catch (err) {
    // Degrade to the keyword engine rather than failing the submission.
    console.warn('[bert-api] inference unavailable, falling back to keyword classifier:', err.message);
    const fallback = await analyzeTextKeyword(text, userCategory, selfAssessment);
    // The floor applies here too. The keyword scorer is the weakest path in
    // the system and the one running when the service is down, so it is the
    // path that most needs a guaranteed minimum.
    const floored = applySafetyFloor(text, fallback.priorityScore, fallback.priorityLevel);
    return {
      ...fallback,
      priorityScore: floored.priorityScore,
      priorityLevel: floored.priorityLevel,
      safetyOverride: floored.override,
      // Recorded explicitly. This is the branch that most needs to be visible
      // downstream: the model never ran, and the keyword scorer that did is
      // markedly worse on Taglish. A report triaged here should not look
      // identical in the database to one the model judged.
      prioritySource: floored.override.applied ? 'safety_floor' : 'keyword',
      source: 'fallback',
      fallbackReason: err.message,
    };
  }

  // Priority comes from the model when the checkpoint has a priority head.
  // The keyword scorer is the fallback, and it is a poor one on Taglish: its
  // urgency lists are English-centric, so "Pumutok yung tubo, tumatalsik ang
  // tubig" (burst pipe) and "May nahimatay na customer" (customer collapsed)
  // both score Medium. Prefer the model wherever it is available.
  let priorityScore, priorityLevel, prioritySource;
  if (prediction.priority) {
    priorityScore = prediction.priority.priority_score;
    priorityLevel = prediction.priority.priority_level;
    prioritySource = 'model';
  } else {
    ({ priorityScore, priorityLevel } =
      scorePriority(text, prediction.category, selfAssessment, { jitter: false }));
    prioritySource = 'keyword';
  }

  // Applied client-side even though the server applies it too: this client may
  // be talking to an older serve.py that has no floor, and the guarantee must
  // not depend on which build is deployed. Idempotent when both apply it.
  const floored = applySafetyFloor(text, priorityScore, priorityLevel);
  if (floored.override.applied) prioritySource = 'safety_floor';
  priorityScore = floored.priorityScore;
  priorityLevel = floored.priorityLevel;

  return {
    category: prediction.category,
    confidence: prediction.confidence,
    priorityScore,
    priorityLevel,
    language: detectLanguage(String(text).toLowerCase()),
    reasoning: buildReasoning(prediction, userCategory, floored.override),
    keywords: [],                       // model gives no keyword evidence
    allScores: prediction.all_probabilities,
    source: 'model',
    prioritySource,                     // 'model' | 'keyword' | 'safety_floor'
    safetyOverride: floored.override,
    priorityConfidence: prediction.priority?.priority_confidence ?? null,
    margin: prediction.margin,
    modelName: prediction.model,
    elapsedMs: prediction.elapsed_ms,
  };
}


/**
 * POST the report text to the inference service.
 * @throws {Error} on timeout, network failure, or non-200 response
 */
async function callInferenceService(text, userCategory) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${API_BASE}/classify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, user_category: userCategory || null }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`inference service returned ${res.status}`);
    return await res.json();
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`timed out after ${TIMEOUT_MS}ms`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}


/**
 * Explanation shown to admins in the HITL queue.
 *
 * States the two things a reviewer needs: how sure the model was, and whether
 * it was torn between categories. A narrow margin deserves a look even when
 * the headline confidence reads acceptably.
 */
function buildReasoning(prediction, userCategory, safetyOverride) {
  const conf = prediction.confidence;
  let reason = `${prediction.model} classified this as ${prediction.category_label} at ${conf}% confidence. `;

  if (prediction.margin < 15) {
    reason += `The margin over the runner-up is only ${prediction.margin} points, so the model was close to another category — worth a second look. `;
  } else if (conf >= 85) {
    reason += 'Clear separation from the alternatives. ';
  } else if (conf >= 65) {
    reason += 'Moderate confidence with reasonable separation. ';
  } else {
    reason += 'Low confidence — the description may not resemble the training data. ';
  }

  if (prediction.priority) {
    const p = prediction.priority;
    reason += `Priority assessed as ${p.priority_label} at ${p.priority_confidence}% confidence, read from the description. `;
  } else {
    reason += 'Priority was scored by keyword matching, not by the model. ';
  }

  // Stated explicitly and with the model's original answer intact. A reviewer
  // looking at a High report needs to know it was floored rather than judged,
  // and needs to see what the model actually said in order to distrust it.
  if (safetyOverride?.applied) {
    reason += `Safety override: the report contains ${safetyOverride.matchedTerms.map((t) => `"${t}"`).join(', ')}, `
            + `so priority was raised to a minimum of High. The model had scored this `
            + `${safetyOverride.modelPriorityLevel} (${safetyOverride.modelPriorityScore}). `;
  } else if (safetyOverride?.matchedTerms?.length) {
    reason += `Contains safety keyword(s) ${safetyOverride.matchedTerms.map((t) => `"${t}"`).join(', ')}; `
            + `the model had already reached the High floor on its own. `;
  }

  if (userCategory && userCategory !== prediction.category) {
    reason += `Note: the tenant selected "${userCategory}", which disagrees with the model. `;
  }
  return reason.trim();
}


/** Liveness probe — useful for an admin status panel. */
export async function checkHealth() {
  try {
    const res = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(3000) });
    return res.ok ? await res.json() : { status: 'error', code: res.status };
  } catch (err) {
    return { status: 'unreachable', error: err.message };
  }
}
