/* ============================================================
   Simulated BERT NLP Classification Engine
   Processes Taglish/Filipino/English text for facility issues
   ============================================================ */

/* --- Keyword Dictionaries --- */
const CATEGORY_KEYWORDS = {
  electrical: {
    keywords: ['ilaw', 'light', 'lights', 'kuryente', 'electricity', 'power', 'outlet', 'socket', 'brownout', 'brown out', 'brown-out', 'spark', 'sparking', 'nag-spark', 'wiring', 'wire', 'circuit', 'breaker', 'switch', 'flicker', 'flickering', 'nagf-flicker', 'buzzing', 'burned', 'burnt', 'ballast', 'transformer', 'voltage', 'fuse', 'signage'],
    weight: 0.7,
  },
  plumbing: {
    keywords: ['tubig', 'water', 'gripo', 'faucet', 'leak', 'leaking', 'tumutulo', 'dripping', 'pipe', 'piping', 'banyo', 'toilet', 'cr', 'restroom', 'bathroom', 'sink', 'drain', 'clogged', 'barado', 'overflow', 'baha', 'flood', 'pressure', 'basag', 'sewage'],
    weight: 0.7,
  },
  hvac: {
    keywords: ['aircon', 'air con', 'air conditioning', 'ac', 'hvac', 'init', 'mainit', 'hot', 'heating', 'malamig', 'cold', 'lamig', 'thermostat', 'temperature', 'ventilation', 'vent', 'fan', 'blower', 'condenser', 'compressor', 'freon', 'refrigerant', 'cooling', 'kalampag', 'maingay', 'condensation'],
    weight: 0.65,
  },
  structural: {
    keywords: ['crack', 'bitak', 'dingding', 'wall', 'ceiling', 'sahig', 'floor', 'tile', 'tiles', 'pinto', 'door', 'bintana', 'window', 'glass', 'broken', 'sira', 'basag', 'concrete', 'paint', 'peeling', 'stain', 'damage', 'foundation', 'column', 'pillar', 'hairline'],
    weight: 0.6,
  },
  pest: {
    keywords: ['ipis', 'cockroach', 'daga', 'rat', 'mouse', 'mice', 'langgam', 'ant', 'ants', 'insect', 'insekto', 'pest', 'fumigation', 'bug', 'termite', 'anay', 'mosquito', 'lamok', 'spider', 'gagamba', 'infestation'],
    weight: 0.5,
  },
  elevator: {
    keywords: ['elevator', 'escalator', 'lift', 'stuck', 'huminto', 'hinto', 'stopped', 'moving', 'button', 'floor indicator', 'overloaded'],
    weight: 0.8,
  },
  fire_safety: {
    keywords: ['fire', 'sunog', 'nasusunog', 'smoke', 'usok', 'extinguisher', 'alarm', 'sprinkler', 'emergency', 'exit', 'detector', 'smoke detector', 'expired', 'fire exit', 'evacuation', 'nag-beep'],
    weight: 0.85,
  },
  housekeeping: {
    keywords: ['madumi', 'dirty', 'kalat', 'basura', 'trash', 'garbage', 'linis', 'clean', 'cleaning', 'mop', 'sweep', 'janitorial', 'restroom', 'tissue', 'soap', 'sabon', 'amoy', 'smell', 'odor', 'mabaho', 'stink', 'moldy', 'mold'],
    weight: 0.35,
  },
  security: {
    keywords: ['cctv', 'camera', 'security', 'guard', 'guard', 'theft', 'nakaw', 'alarm', 'lock', 'susi', 'key', 'access', 'gate', 'door lock', 'dim', 'lighting', 'suspicious', 'vandal', 'sliding door'],
    weight: 0.55,
  },
  it_network: {
    keywords: ['internet', 'wifi', 'wi-fi', 'network', 'connection', 'server', 'pos', 'system', 'computer', 'printer', 'bagal', 'slow', 'disconnect', 'disconnecting', 'cable', 'router', 'modem', 'bandwidth', 'signal'],
    weight: 0.5,
  },
};

/* Urgency / severity boosting keywords */
const URGENCY_KEYWORDS = {
  critical: ['emergency', 'fire', 'sunog', 'stuck', 'trapped', 'nasusunog', 'nag-spark', 'spark', 'explosion', 'electrocute', 'danger', 'collapse', 'flood', 'baha'],
  high: ['urgent', 'asap', 'immediately', 'sobrang', 'hindi gumagana', 'hindi na', 'sira na', 'nakakaalarma', 'malaki', 'grabe', 'need urgent', 'help po', 'overflow', 'expired'],
  medium: ['parang', 'medyo', 'minsan', 'sometimes', 'occasional', 'not working properly', 'maingay', 'nakakahiya', 'madalas'],
  low: ['requesting', 'request', 'sana', 'paki', 'please', 'suggestion', 'minor', 'small', 'konti'],
};

/* Self-assessment multipliers */
const SELF_ASSESS_MULTIPLIER = {
  urgent: 1.25,
  medium: 1.0,
  low: 0.8,
};


/**
 * Simulated BERT analysis — processes unstructured Taglish text
 * @param {string} text - The raw issue description
 * @param {string} userCategory - User-selected category (optional hint)
 * @param {string} selfAssessment - User self-assessed urgency: 'low'|'medium'|'urgent'
 * @returns {Promise<Object>} Analysis result
 */
export async function analyzeText(text, userCategory = '', selfAssessment = 'medium') {
  // Simulate processing delay (1-2.5 seconds)
  const delay = 1000 + Math.random() * 1500;
  await new Promise(resolve => setTimeout(resolve, delay));

  const lowerText = text.toLowerCase();
  const words = lowerText.split(/\s+/);

  // --- 1. Language Detection ---
  const language = detectLanguage(lowerText);

  // --- 2. Category Classification ---
  const categoryScores = {};
  const matchedKeywords = {};

  for (const [cat, data] of Object.entries(CATEGORY_KEYWORDS)) {
    let score = 0;
    const matched = [];
    for (const kw of data.keywords) {
      if (lowerText.includes(kw)) {
        score += 1;
        matched.push(kw);
      }
    }
    categoryScores[cat] = score;
    matchedKeywords[cat] = matched;
  }

  // Find best category
  let bestCat = userCategory || 'other';
  let bestScore = 0;
  for (const [cat, score] of Object.entries(categoryScores)) {
    if (score > bestScore) {
      bestScore = score;
      bestCat = cat;
    }
  }

  // If user category matches well, boost it
  if (userCategory && categoryScores[userCategory] > 0) {
    bestCat = userCategory;
    bestScore = categoryScores[userCategory];
  }

  // Confidence calculation (60% - 98%)
  const maxPossible = Math.max(5, CATEGORY_KEYWORDS[bestCat]?.keywords.length || 5);
  let confidence = Math.min(98, Math.max(60, Math.round(60 + (bestScore / maxPossible) * 38 + Math.random() * 10)));

  // If user category matches AI category, boost confidence
  if (userCategory === bestCat && bestScore > 0) {
    confidence = Math.min(98, confidence + 5);
  }

  // --- 3. Priority Scoring ---
  let priorityScore = 30; // base

  // Category severity weight
  const catWeight = CATEGORY_KEYWORDS[bestCat]?.weight || 0.5;
  priorityScore += catWeight * 30;

  // Urgency keyword detection
  let detectedUrgency = 'low';
  for (const [level, keywords] of Object.entries(URGENCY_KEYWORDS)) {
    for (const kw of keywords) {
      if (lowerText.includes(kw)) {
        if (level === 'critical') { priorityScore += 25; detectedUrgency = 'critical'; }
        else if (level === 'high') { priorityScore += 15; detectedUrgency = 'high'; }
        else if (level === 'medium') { priorityScore += 5; detectedUrgency = 'medium'; }
        break;
      }
    }
  }

  // Self-assessment multiplier
  const multiplier = SELF_ASSESS_MULTIPLIER[selfAssessment] || 1.0;
  priorityScore = Math.round(priorityScore * multiplier);

  // Clamp & add slight randomness
  priorityScore = Math.min(99, Math.max(10, priorityScore + Math.floor(Math.random() * 8 - 4)));

  // Determine priority level
  let priorityLevel;
  if (priorityScore >= 80) priorityLevel = 'critical';
  else if (priorityScore >= 60) priorityLevel = 'high';
  else if (priorityScore >= 40) priorityLevel = 'medium';
  else priorityLevel = 'low';

  // --- 4. Generate reasoning ---
  const reasoning = generateReasoning(bestCat, matchedKeywords[bestCat] || [], priorityLevel, language, selfAssessment);

  return {
    category: bestCat,
    confidence,
    priorityScore,
    priorityLevel,
    language,
    reasoning,
    keywords: matchedKeywords[bestCat] || [],
    allScores: categoryScores,
  };
}


/**
 * Simple language detection heuristic
 */
function detectLanguage(text) {
  const filipinoMarkers = ['po', 'namin', 'namin', 'yung', 'ang', 'ng', 'mga', 'sa', 'na', 'ko', 'nyo', 'siya', 'kami', 'sana', 'kasi', 'paki', 'parang', 'sobrang', 'hindi', 'wala', 'dito', 'doon', 'ito', 'yun', 'siguro', 'talaga', 'lalo'];
  const englishMarkers = ['the', 'is', 'are', 'was', 'been', 'have', 'has', 'our', 'their', 'please', 'need', 'should', 'would', 'could', 'from', 'with', 'this', 'that', 'which', 'been', 'about'];

  const words = text.split(/\s+/);
  let filCount = 0;
  let engCount = 0;

  for (const word of words) {
    const clean = word.replace(/[^a-z]/g, '');
    if (filipinoMarkers.includes(clean)) filCount++;
    if (englishMarkers.includes(clean)) engCount++;
  }

  if (filCount > 0 && engCount > 0) return 'Taglish';
  if (filCount > engCount) return 'Filipino';
  return 'English';
}


/**
 * Generate human-readable AI reasoning
 */
function generateReasoning(category, keywords, priorityLevel, language, selfAssessment) {
  const categoryLabels = {
    electrical: 'Electrical System', plumbing: 'Plumbing', hvac: 'HVAC / Air Conditioning',
    structural: 'Structural', pest: 'Pest Control', elevator: 'Elevator/Escalator',
    fire_safety: 'Fire Safety', housekeeping: 'Housekeeping', security: 'Security',
    it_network: 'IT/Network', other: 'General',
  };

  const priorityExplanations = {
    critical: 'Immediate safety or operational risk detected.',
    high: 'Significant impact on tenant operations or safety.',
    medium: 'Moderate impact, standard maintenance response.',
    low: 'Minor issue, can be scheduled for routine maintenance.',
  };

  let reason = `Detected ${language} text. `;
  if (keywords.length > 0) {
    reason += `Keywords identified: "${keywords.slice(0, 4).join('", "')}" → ${categoryLabels[category] || category}. `;
  }
  reason += priorityExplanations[priorityLevel] || '';

  if (selfAssessment === 'urgent') {
    reason += ' Tenant marked as urgent — priority boosted.';
  }

  return reason;
}
