-- ============================================================
--  migration_008_safety_terms.sql
--
--  Moves the safety-floor word list out of code and into the database, so a
--  Property Management Office admin can add, disable or remove terms without
--  a developer and a redeploy. Requested at the final defense.
--
--  Before this, the list was hardcoded twice — serving/serve.py (server) and
--  js/bert-api.js (browser) — and a change meant editing both and redeploying
--  the Hugging Face Space. Both now read this table and fall back to their
--  built-in list only when it is unreachable or returns no danger terms.
--
--  SHAPE
--  -----
--  One row per string that is matched, not one row per regex. Admins never
--  write patterns: the English entries used to be regexes such as
--  smok(?:e|es|ing|y), and a regex field would let one typo match every report
--  or hang the matcher. Inflections are separate rows sharing a `label` —
--  smoke / smokes / smoking / smoky all report as "smoke" — which reproduces
--  the old patterns exactly.
--
--    kind='danger',    match_type='substring'  Tagalog stems. "usok" also
--                                              matches "umuusok".
--    kind='danger',    match_type='word'       Whole words only, so "spark"
--                                              does not fire on "sparkling".
--    kind='exclusion', match_type='phrase'     Device names blanked BEFORE
--                                              matching — "smoke detector".
--
--  ACCESS
--  ------
--  The table itself is admin-only. Everyone else — including tenants' browsers
--  and the inference service, which calls as anon — reads through
--  get_safety_terms(), which returns only the columns needed to match. That
--  keeps notes and who-added-what private without a security-definer VIEW,
--  which Supabase's linter reports as an error. The function does draw the
--  lower-severity "security definer function executable" warning; that is
--  intentional here, and it only ever reads.
--
--  APPLY ORDER: after migration_007_tenant_signup_trigger.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS public.safety_terms (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        TEXT        NOT NULL,
  match_type  TEXT        NOT NULL,
  term        TEXT        NOT NULL,
  label       TEXT        NOT NULL,
  active      BOOLEAN     NOT NULL DEFAULT true,
  sort_order  INTEGER     NOT NULL DEFAULT 500,
  note        TEXT,
  created_by  UUID        REFERENCES public.profiles (id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT safety_terms_kind_match CHECK (
    (kind = 'danger'    AND match_type IN ('substring', 'word')) OR
    (kind = 'exclusion' AND match_type = 'phrase')
  ),

  /* Letters only (plus ñ), lowercase, and long enough to mean something.
     A two-letter substring like "na" appears in almost every Tagalog report
     and would floor all of them to High. Phrases need at least two words. */
  CONSTRAINT safety_terms_term_shape CHECK (
    char_length(term) BETWEEN 3 AND 60 AND
    term = lower(term) AND
    (
      (match_type IN ('substring', 'word') AND term ~ '^[a-zñ]+$') OR
      (match_type = 'phrase'               AND term ~ '^[a-zñ]+([ -][a-zñ]+)+$')
    )
  ),

  CONSTRAINT safety_terms_label_shape CHECK (
    char_length(label) BETWEEN 3 AND 60 AND label = lower(label)
  ),

  CONSTRAINT safety_terms_unique UNIQUE (kind, match_type, term)
);

COMMENT ON TABLE public.safety_terms IS
  'Safety-floor vocabulary. Danger terms raise a report to at least High; '
  'exclusion phrases are blanked before matching. Read publicly through '
  'get_safety_terms(); writable by admins only.';


-- ---------- updated_at ----------
CREATE OR REPLACE FUNCTION public.safety_terms_touch()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_safety_terms_touch ON public.safety_terms;
CREATE TRIGGER trg_safety_terms_touch
  BEFORE UPDATE ON public.safety_terms
  FOR EACH ROW EXECUTE FUNCTION public.safety_terms_touch();


-- ---------- never leave the floor empty ----------
/* Disabling or deleting the last active danger term would silently switch
   the safety guarantee off. Refused here rather than only in the admin page,
   so it holds for the SQL editor too. (The server and browser also fall back
   to their built-in list if they ever receive zero danger terms.) */
CREATE OR REPLACE FUNCTION public.safety_terms_keep_one()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF (SELECT count(*) FROM public.safety_terms
      WHERE kind = 'danger' AND active) = 0 THEN
    RAISE EXCEPTION 'At least one active danger term is required — the safety floor cannot be left empty.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_safety_terms_keep_one ON public.safety_terms;
CREATE CONSTRAINT TRIGGER trg_safety_terms_keep_one
  AFTER UPDATE OR DELETE ON public.safety_terms
  DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW EXECUTE FUNCTION public.safety_terms_keep_one();


-- ---------- access ----------
ALTER TABLE public.safety_terms ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.safety_terms FROM anon;
REVOKE ALL ON public.safety_terms FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.safety_terms TO authenticated;

DROP POLICY IF EXISTS "safety_terms_admin_select" ON public.safety_terms;
CREATE POLICY "safety_terms_admin_select"
  ON public.safety_terms FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "safety_terms_admin_insert" ON public.safety_terms;
CREATE POLICY "safety_terms_admin_insert"
  ON public.safety_terms FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "safety_terms_admin_update" ON public.safety_terms;
CREATE POLICY "safety_terms_admin_update"
  ON public.safety_terms FOR UPDATE
  TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "safety_terms_admin_delete" ON public.safety_terms;
CREATE POLICY "safety_terms_admin_delete"
  ON public.safety_terms FOR DELETE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));


-- ---------- public read path ----------
/* The only way non-admins read the list. Active rows, matching columns only.
   Ordered so every caller builds the same matched_terms order. */
CREATE OR REPLACE FUNCTION public.get_safety_terms()
RETURNS TABLE (kind TEXT, match_type TEXT, term TEXT, label TEXT, sort_order INTEGER)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT st.kind, st.match_type, st.term, st.label, st.sort_order
  FROM public.safety_terms st
  WHERE st.active
  ORDER BY st.kind, st.sort_order, st.term;
$$;

REVOKE ALL ON FUNCTION public.get_safety_terms() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_safety_terms() TO anon, authenticated;

REVOKE ALL ON FUNCTION public.safety_terms_touch()    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.safety_terms_keep_one() FROM PUBLIC, anon, authenticated;


-- ---------- seed: exactly the list that was hardcoded ----------
/* Reproduces serve.py / bert-api.js as of 2026-09-16:
     substrings  sunog usok apoy nakuryente nakoryente naipit naiipit
     words       trapped · smok(?:e|es|ing|y) · spark(?:s|ed|ing)?
     exclusions  smoke[\s-]?(detector|detectors|alarm|alarms|sensor|sensors)
                 no[\s-]smoking · smoking[\s-]area · smoke[\s-]free
   created_by is NULL: these came from the original build, not an admin. */
INSERT INTO public.safety_terms (kind, match_type, term, label, sort_order, note, created_by) VALUES
  ('danger', 'substring', 'sunog',      'sunog',      10, 'Fire / burning: sunog, nasusunog, amoy sunog', NULL),
  ('danger', 'substring', 'usok',       'usok',       20, 'Smoke: usok, umuusok, mausok', NULL),
  ('danger', 'substring', 'apoy',       'apoy',       30, 'Flame. Added 2026-08-13 after the only severe underestimate in the test set.', NULL),
  ('danger', 'substring', 'nakuryente', 'nakuryente', 40, 'A person was shocked. Bare "kuryente" (electricity) is deliberately absent.', NULL),
  ('danger', 'substring', 'nakoryente', 'nakoryente', 50, 'Common spelling of nakuryente.', NULL),
  ('danger', 'substring', 'naipit',     'naipit',     60, 'Trapped / caught: naipit, na-ipit', NULL),
  ('danger', 'substring', 'naiipit',    'naiipit',    70, 'Trapped, progressive form. Not a substring of naipit.', NULL),

  ('danger', 'word', 'trapped',  'trapped', 110, NULL, NULL),
  ('danger', 'word', 'smoke',    'smoke',   120, NULL, NULL),
  ('danger', 'word', 'smokes',   'smoke',   121, NULL, NULL),
  ('danger', 'word', 'smoking',  'smoke',   122, NULL, NULL),
  ('danger', 'word', 'smoky',    'smoke',   123, NULL, NULL),
  ('danger', 'word', 'spark',    'sparks',  130, 'Whole word, so "sparkling" does not fire.', NULL),
  ('danger', 'word', 'sparks',   'sparks',  131, NULL, NULL),
  ('danger', 'word', 'sparked',  'sparks',  132, NULL, NULL),
  ('danger', 'word', 'sparking', 'sparks',  133, NULL, NULL),

  ('exclusion', 'phrase', 'smoke detector',  'smoke detector',  210, 'Device name, not an event.', NULL),
  ('exclusion', 'phrase', 'smoke detectors', 'smoke detector',  211, NULL, NULL),
  ('exclusion', 'phrase', 'smoke alarm',     'smoke alarm',     220, NULL, NULL),
  ('exclusion', 'phrase', 'smoke alarms',    'smoke alarm',     221, NULL, NULL),
  ('exclusion', 'phrase', 'smoke sensor',    'smoke sensor',    230, NULL, NULL),
  ('exclusion', 'phrase', 'smoke sensors',   'smoke sensor',    231, NULL, NULL),
  ('exclusion', 'phrase', 'no smoking',      'no smoking',      240, 'Signage, not an event.', NULL),
  ('exclusion', 'phrase', 'smoking area',    'smoking area',    250, NULL, NULL),
  ('exclusion', 'phrase', 'smoke free',      'smoke free',      260, NULL, NULL)
ON CONFLICT (kind, match_type, term) DO NOTHING;
