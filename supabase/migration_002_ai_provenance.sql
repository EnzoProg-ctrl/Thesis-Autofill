-- =====================================================================
--  migration_002_ai_provenance.sql
--  Record WHERE a report's priority came from.
--
--  Run against an existing database. schema.sql is left alone so a fresh
--  install and a migrated install do not drift; the same columns are added
--  there for new deployments.
-- =====================================================================
--
--  Why this exists
--  ---------------
--  The app already stores ai_priority_score, but not how it was produced.
--  Three different things can set it, and they are not equally trustworthy:
--
--    'model'         the trained XLM-R priority head
--    'keyword'       the fallback scorer in js/keyword-classifier.js, used
--                    when the service is unreachable. It is markedly worse on
--                    Taglish — it scored "May naipit na tao sa pinto"
--                    (a person is trapped in a door) at 38/low.
--    'safety_floor'  the deterministic keyword floor raised it to High
--
--  Without this, a day when the inference service was down is indistinguishable
--  from a normal day, and nobody can tell which reports were triaged by the
--  weak scorer. It also makes the safety floor auditable: when a report is
--  routed High on the strength of the word "sunog", that fact should be on the
--  record, along with what the model actually said.
--
--  This is an audit trail, not a feature. It costs three nullable columns.
-- =====================================================================

ALTER TABLE issues
  ADD COLUMN IF NOT EXISTS ai_priority_source   TEXT,
  ADD COLUMN IF NOT EXISTS ai_safety_terms      TEXT,
  ADD COLUMN IF NOT EXISTS ai_model_priority    TEXT;

-- Constrained rather than free text: an unrecognised value here means the
-- client and the service have drifted, and that should fail loudly.
ALTER TABLE issues
  DROP CONSTRAINT IF EXISTS issues_ai_priority_source_check;
ALTER TABLE issues
  ADD CONSTRAINT issues_ai_priority_source_check
  CHECK (ai_priority_source IS NULL
         OR ai_priority_source IN ('model', 'keyword', 'safety_floor'));

COMMENT ON COLUMN issues.ai_priority_source IS
  'Which mechanism set ai_priority_score: model | keyword | safety_floor. '
  'NULL for rows predating this migration.';
COMMENT ON COLUMN issues.ai_safety_terms IS
  'Comma-separated danger keywords found in the report text (sunog, usok, '
  'apoy, nakuryente, naipit, trapped, smoke, sparks). Populated whenever any '
  'are present, even if the model had already reached High unaided.';
COMMENT ON COLUMN issues.ai_model_priority IS
  'The level the MODEL predicted, when the safety floor overrode it. Kept so a '
  'reviewer can see the two disagreed rather than only seeing the final answer.';

-- Finding every floor-triggered report is a routine audit question
-- ("what did we escalate on keywords last month, and was it justified?"),
-- so it gets an index rather than a sequential scan.
CREATE INDEX IF NOT EXISTS idx_issues_ai_priority_source
  ON issues (ai_priority_source)
  WHERE ai_priority_source IS NOT NULL;
