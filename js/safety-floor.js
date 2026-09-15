/* ============================================================
   Safety-floor term matching

   Shared by the tenant client (bert-api.js) and the admin Safety Terms page,
   so the page's "test a sentence" box behaves exactly like a real
   submission. Pure: no DOM, no Supabase, runs under node — which is what
   lets RobertaTraining/test_safety_floor.py execute it directly.

   The terms themselves live in public.safety_terms (migration_008) and are
   edited by admins. BUILTIN_SAFETY_TERMS below is the fallback used when the
   table is unreachable or returns no danger terms: a safety guarantee that
   disappears with the network is not a guarantee.

   MIRRORED IN serving/serve.py (_BUILTIN_SAFETY_TERMS, _compile_terms,
   safety_floor_terms). Same rows, same matching rules.
   ============================================================ */

/* Row shape matches get_safety_terms():
     kind        'danger' | 'exclusion'
     match_type  'substring' | 'word' | 'phrase'
     term        the string matched
     label       the name reported when it matches — inflections share one,
                 so "smoking" reports as "smoke"
     sort_order  fixes the order of matched labels

   Tagalog stems are SUBSTRINGS: infixes and reduplication wrap the root —
   "usok" becomes "umuusok", "sunog" becomes "nasusunog" — so a whole-word
   match would miss exactly how tenants write.

   Bare "kuryente" is deliberately absent: it just means "electricity", and
   "walang kuryente" (no power) is an ordinary Medium report. Only the na-
   form, a person being shocked, is danger. English "fire" is absent for the
   same reason: "fire exit", "fire drill", "fire extinguisher".

   English terms are WHOLE WORDS, so "sparkling" does not fire. Their
   inflections are listed explicitly rather than written as a regex.

   Exclusions are device names and signage, blanked BEFORE matching.
   "Please test our smoke detector" is a compliance chore, not a fire — but
   "the smoke detector is going off and the hall is full of smoke" still trips
   on the second "smoke". */
export const BUILTIN_SAFETY_TERMS = [
  { kind: 'danger', match_type: 'substring', term: 'sunog',      label: 'sunog',      sort_order: 10 },
  { kind: 'danger', match_type: 'substring', term: 'usok',       label: 'usok',       sort_order: 20 },
  { kind: 'danger', match_type: 'substring', term: 'apoy',       label: 'apoy',       sort_order: 30 },
  { kind: 'danger', match_type: 'substring', term: 'nakuryente', label: 'nakuryente', sort_order: 40 },
  { kind: 'danger', match_type: 'substring', term: 'nakoryente', label: 'nakoryente', sort_order: 50 },
  { kind: 'danger', match_type: 'substring', term: 'naipit',     label: 'naipit',     sort_order: 60 },
  { kind: 'danger', match_type: 'substring', term: 'naiipit',    label: 'naiipit',    sort_order: 70 },

  { kind: 'danger', match_type: 'word', term: 'trapped',  label: 'trapped', sort_order: 110 },
  { kind: 'danger', match_type: 'word', term: 'smoke',    label: 'smoke',   sort_order: 120 },
  { kind: 'danger', match_type: 'word', term: 'smokes',   label: 'smoke',   sort_order: 121 },
  { kind: 'danger', match_type: 'word', term: 'smoking',  label: 'smoke',   sort_order: 122 },
  { kind: 'danger', match_type: 'word', term: 'smoky',    label: 'smoke',   sort_order: 123 },
  { kind: 'danger', match_type: 'word', term: 'spark',    label: 'sparks',  sort_order: 130 },
  { kind: 'danger', match_type: 'word', term: 'sparks',   label: 'sparks',  sort_order: 131 },
  { kind: 'danger', match_type: 'word', term: 'sparked',  label: 'sparks',  sort_order: 132 },
  { kind: 'danger', match_type: 'word', term: 'sparking', label: 'sparks',  sort_order: 133 },

  { kind: 'exclusion', match_type: 'phrase', term: 'smoke detector',  label: 'smoke detector', sort_order: 210 },
  { kind: 'exclusion', match_type: 'phrase', term: 'smoke detectors', label: 'smoke detector', sort_order: 211 },
  { kind: 'exclusion', match_type: 'phrase', term: 'smoke alarm',     label: 'smoke alarm',    sort_order: 220 },
  { kind: 'exclusion', match_type: 'phrase', term: 'smoke alarms',    label: 'smoke alarm',    sort_order: 221 },
  { kind: 'exclusion', match_type: 'phrase', term: 'smoke sensor',    label: 'smoke sensor',   sort_order: 230 },
  { kind: 'exclusion', match_type: 'phrase', term: 'smoke sensors',   label: 'smoke sensor',   sort_order: 231 },
  { kind: 'exclusion', match_type: 'phrase', term: 'no smoking',      label: 'no smoking',     sort_order: 240 },
  { kind: 'exclusion', match_type: 'phrase', term: 'smoking area',    label: 'smoking area',   sort_order: 250 },
  { kind: 'exclusion', match_type: 'phrase', term: 'smoke free',      label: 'smoke free',     sort_order: 260 },
];

/* Mirrors the database CHECK constraints, so the admin page can reject a bad
   term before the server does and the matcher never sees one. */
export const TERM_RULES = {
  minLength: 3,
  maxLength: 60,
  single: /^[a-zñ]+$/,
  phrase: /^[a-zñ]+([ -][a-zñ]+)+$/,
};

export function validateTerm(term, matchType) {
  const t = String(term ?? '').trim().toLowerCase();
  if (t.length < TERM_RULES.minLength) return `Must be at least ${TERM_RULES.minLength} letters.`;
  if (t.length > TERM_RULES.maxLength) return `Must be at most ${TERM_RULES.maxLength} characters.`;
  if (matchType === 'phrase') {
    if (!TERM_RULES.phrase.test(t)) return 'Use two or more words made of letters, separated by a space or hyphen.';
  } else if (!TERM_RULES.single.test(t)) {
    return 'Letters only — no spaces, numbers or symbols.';
  }
  return null;
}

/* Word boundaries are written as explicit lookarounds over the SAME character
   class the Python side uses. JavaScript's \b is ASCII-only while Python's is
   Unicode-aware, so \b would let the two sides disagree on text containing ñ.
   Lookbehind is supported by every current browser and by node. */
const WORD_CHAR = 'a-z0-9_ñ';
const BEFORE = `(?<![${WORD_CHAR}])`;
const AFTER = `(?![${WORD_CHAR}])`;

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* Plain code-point comparison, not localeCompare, so ties on sort_order break
   the same way here as in Python's sorted(). */
function byOrder(a, b) {
  const ta = String(a.term), tb = String(b.term);
  return (a.sort_order ?? 500) - (b.sort_order ?? 500) || (ta < tb ? -1 : ta > tb ? 1 : 0);
}

function groupByLabel(rows) {
  const groups = new Map();   // insertion order = first sort_order seen
  for (const row of rows) {
    if (!groups.has(row.label)) groups.set(row.label, []);
    groups.get(row.label).push(String(row.term).toLowerCase());
  }
  return [...groups.entries()];
}

/**
 * Build a matcher from term rows. Returns null when there is no danger term,
 * so callers keep their current list rather than switching the floor off.
 */
export function compileSafetyTerms(rows) {
  const clean = (rows || []).filter(r => r && r.term && r.label);
  const danger = clean.filter(r => r.kind === 'danger').sort(byOrder);
  if (danger.length === 0) return null;

  const substrings = groupByLabel(danger.filter(r => r.match_type === 'substring'));
  const words = groupByLabel(danger.filter(r => r.match_type === 'word'))
    .map(([label, terms]) => [label, new RegExp(`${BEFORE}(?:${terms.map(escapeRe).join('|')})${AFTER}`)]);

  const phrases = clean.filter(r => r.kind === 'exclusion' && r.match_type === 'phrase').sort(byOrder)
    .map(r => String(r.term).toLowerCase().split(/[ -]+/).map(escapeRe).join('[\\s-]?'));
  const exclusionRe = phrases.length
    ? new RegExp(`${BEFORE}(?:${phrases.join('|')})${AFTER}`, 'g')
    : null;

  return {
    substrings,
    words,
    exclusionRe,
    dangerCount: danger.length,
    exclusionCount: phrases.length,
  };
}

/**
 * Danger labels present in `text`, in a stable order. Empty array if none.
 */
export function matchSafetyTerms(text, compiled) {
  if (!compiled) return [];
  let haystack = String(text ?? '').toLowerCase();
  if (compiled.exclusionRe) haystack = haystack.replace(compiled.exclusionRe, ' ');
  /* Taglish writes the same word with and without a hyphen ("na-kuryente").
     Only the substring pass gets the de-hyphenated form: stripping hyphens
     would destroy a whole-word match, turning "nag-spark" into "nagspark". */
  const dehyphenated = haystack.replace(/-/g, '');

  const hits = [];
  for (const [label, terms] of compiled.substrings) {
    if (terms.some(t => haystack.includes(t) || dehyphenated.includes(t))) hits.push(label);
  }
  for (const [label, re] of compiled.words) {
    if (!hits.includes(label) && re.test(haystack)) hits.push(label);
  }
  return hits;
}

export const BUILTIN_COMPILED = compileSafetyTerms(BUILTIN_SAFETY_TERMS);
