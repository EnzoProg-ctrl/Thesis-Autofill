-- ============================================================
--  demo_seed.sql — fictional demo data for a FIRS demo database
--
--  Fills a database built with setup.sql with made-up stores, maintenance
--  staff and about thirty reports spread over the last thirty days, so every
--  screen (review queue, dashboard, staff work queue, analytics) has
--  something to show. Every name, store, phone number and report here is
--  invented. NO real participant data is used.
--
--  BEFORE RUNNING
--  --------------
--  Create these three sign-in accounts in the Supabase dashboard
--  (Authentication > Users > Add user > Create new user, with
--  "Auto Confirm User" ticked), using the passwords you want to publish:
--
--      demo.admin@example.com    administrator
--      demo.staff@example.com    maintenance staff (electrician)
--      demo.store@example.com    store
--
--  example.com is reserved for documentation, so no real mailbox can receive
--  mail for these addresses.
--
--  Then run this whole file in the SQL Editor.
--
--  RESETTING THE DEMO
--  ------------------
--  Run this file again at any time. It removes every account visitors
--  created (and their reports), recreates the demo reports with fresh dates
--  and ticket numbers from ISS-001, restores the demo accounts' names and
--  roles, removes safety terms visitors added, and switches the original ones
--  back on. It does not change passwords; see the end of this file for that.
--
--  SAFETY
--  ------
--  The first run refuses a database that already holds any store whose email
--  is not @example.com, so it cannot be run on a real system by mistake.
--  After that, the demo database is recognised by the fictional stores this
--  file creates, and only there does a re-run delete visitors' accounts.
-- ============================================================

DO $$
DECLARE
  -- Set once this file has run here: the fictional stores below exist.
  is_demo boolean := EXISTS (SELECT 1 FROM auth.users WHERE id = 'd0000000-0000-4000-8000-000000000101');
BEGIN
  IF NOT is_demo AND EXISTS (SELECT 1 FROM public.tenants WHERE email NOT LIKE '%@example.com') THEN
    RAISE EXCEPTION 'This database has real stores in it. demo_seed.sql only runs on a demo database.';
  END IF;
  IF (SELECT count(*) FROM auth.users WHERE email IN
        ('demo.admin@example.com', 'demo.staff@example.com', 'demo.store@example.com')) <> 3 THEN
    RAISE EXCEPTION 'Create the three demo sign-in accounts first (see the top of this file).';
  END IF;

  /* Reset: remove every account a visitor created (stores registered from
     the site, staff added through Manage Users). Their store records,
     profiles and reports go with them. */
  IF is_demo THEN
    DELETE FROM auth.users
    WHERE email NOT IN ('demo.admin@example.com', 'demo.staff@example.com', 'demo.store@example.com')
      AND id::text NOT LIKE 'd0000000-0000-4000-8000-%';
  END IF;
END $$;


-- ---------- Accounts that cannot sign in ----------
/* The other stores and staff only exist so the dashboards look like a real
   mall. They have no password, so nobody can sign in as them. Stores are
   created the way registration creates them: the store details travel as
   user metadata and the handle_new_tenant trigger writes the tenants row. */
INSERT INTO auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('d0000000-0000-4000-8000-000000000101', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'lumen.optical@example.com', '{"provider":"email","providers":["email"]}',
   '{"store_name":"Lumen Optical","floor":"Ground Floor","contact_person":"Carla Mendoza","phone_number":"09000000101"}', now(), now()),
  ('d0000000-0000-4000-8000-000000000102', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bahay.kusina@example.com', '{"provider":"email","providers":["email"]}',
   '{"store_name":"Bahay Kusina Express","floor":"Food Court","contact_person":"Rodel Bautista","phone_number":"09000000102"}', now(), now()),
  ('d0000000-0000-4000-8000-000000000103', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'technest@example.com', '{"provider":"email","providers":["email"]}',
   '{"store_name":"TechNest Gadgets","floor":"2nd Floor","contact_person":"Mark Villanueva","phone_number":"09000000103"}', now(), now()),
  ('d0000000-0000-4000-8000-000000000104', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'sole.republic@example.com', '{"provider":"email","providers":["email"]}',
   '{"store_name":"Sole Republic Shoes","floor":"Ground Floor","contact_person":"Jenny Ocampo","phone_number":"09000000104"}', now(), now()),
  ('d0000000-0000-4000-8000-000000000105', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ganda.salon@example.com', '{"provider":"email","providers":["email"]}',
   '{"store_name":"Ganda Salon & Spa","floor":"3rd Floor","contact_person":"Liza Fernandez","phone_number":"09000000105"}', now(), now()),
  ('d0000000-0000-4000-8000-000000000201', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'jose.plumber@example.com', '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('d0000000-0000-4000-8000-000000000202', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana.hvac@example.com', '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('d0000000-0000-4000-8000-000000000203', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'paolo.general@example.com', '{"provider":"email","providers":["email"]}', '{}', now(), now())
ON CONFLICT (id) DO NOTHING;


-- ---------- Roles ----------
INSERT INTO public.profiles (id, full_name, email, role, trade, avatar_initials)
SELECT u.id, p.full_name, u.email, p.role, p.trade, p.initials
FROM (VALUES
  ('demo.admin@example.com',    'Demo Administrator', 'admin', NULL,       'SA'),
  ('demo.staff@example.com',    'Ramon Cruz',         'staff', 'Electrician', 'EL'),
  ('jose.plumber@example.com',  'Jose Reyes',         'staff', 'Plumber',  'PL'),
  ('ana.hvac@example.com',      'Ana Dizon',          'staff', 'HVAC',     'HV'),
  ('paolo.general@example.com', 'Paolo Garcia',       'staff', 'General',  'GN')
) AS p(email, full_name, role, trade, initials)
JOIN auth.users u ON u.email = p.email
ON CONFLICT (id) DO UPDATE
  SET full_name = EXCLUDED.full_name, role = EXCLUDED.role,
      trade = EXCLUDED.trade, avatar_initials = EXCLUDED.avatar_initials;

/* The demo store was created in the dashboard, without registration
   metadata, so its store record is written here. */
INSERT INTO public.tenants (id, store_name, floor, contact_person, phone_number, email, privacy_consented_at)
SELECT id, 'Kape''t Tinapay Café', '2nd Floor', 'Maria Santos', '09000000100', email, now()
FROM auth.users WHERE email = 'demo.store@example.com'
ON CONFLICT (id) DO UPDATE
  SET store_name = EXCLUDED.store_name, floor = EXCLUDED.floor,
      contact_person = EXCLUDED.contact_person, phone_number = EXCLUDED.phone_number;


-- ---------- Safety terms back to the starting list ----------
/* Remove terms visitors added, put back any original term a visitor deleted
   (the same rows as migration_008), and switch them all back on. */
DELETE FROM public.safety_terms WHERE created_by IS NOT NULL;
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
UPDATE public.safety_terms SET active = true WHERE NOT active;


-- ---------- Reports ----------
DELETE FROM public.issues
WHERE tenant_id IN (SELECT id FROM public.tenants WHERE email LIKE '%@example.com');

-- Every report in a demo database is a demo report, so numbering can restart.
SELECT setval('public.issue_ticket_seq', 1, false);

/* One row per report. Columns:
     store       login email of the reporting store
     age_h       hours ago it was submitted
     body        the report, in the tenant's words
     picked      category the tenant chose
     ai_cat      category the model suggested, conf its confidence
     ai_lvl      priority the model (or safety floor) assigned, score 0-100
     src         model | safety_floor | keyword
     terms       danger terms found; model_lvl what the model said before the floor
     lang        English | Filipino | Taglish
     state       awaiting_review | in_progress | resolved
     staff       email of the assigned staff member
     final_cat   category after review; final_lvl priority after review
     notes       reviewer's note when overriding
     fix_h       hours from submission to resolution */
DROP TABLE IF EXISTS demo_reports;
CREATE TEMP TABLE demo_reports (
  store text, age_h numeric, body text, picked text,
  ai_cat text, conf int, ai_lvl text, score int, src text, terms text, model_lvl text, lang text,
  state text, staff text, final_cat text, final_lvl text, notes text, fix_h numeric
);

INSERT INTO demo_reports VALUES
  -- Waiting for review
  ('demo.store@example.com',     3,  'Umuusok yung saksakan sa likod ng counter, amoy sunog na', 'electrical',
   'electrical', 97, 'critical', 88, 'model', 'sunog,usok', NULL, 'Taglish', 'awaiting_review', NULL, NULL, NULL, NULL, NULL),
  ('bahay.kusina@example.com',   5,  'Tumutulo ang tubig galing kisame sa may kitchen area, basa na yung sahig', 'plumbing',
   'plumbing', 94, 'high', 68, 'model', NULL, NULL, 'Taglish', 'awaiting_review', NULL, NULL, NULL, NULL, NULL),
  ('technest@example.com',       8,  'Mahina po yung aircon sa pwesto namin, mainit na sa loob', 'hvac',
   'hvac', 96, 'low', 31, 'model', NULL, NULL, 'Taglish', 'awaiting_review', NULL, NULL, NULL, NULL, NULL),
  ('sole.republic@example.com',  11, 'May lumabas na spark sa ilaw ng display shelf namin', 'electrical',
   'electrical', 92, 'high', 60, 'safety_floor', 'sparks', 'medium', 'Taglish', 'awaiting_review', NULL, NULL, NULL, NULL, NULL),
  ('ganda.salon@example.com',    20, 'Barado ang lababo sa hair washing area, ang bagal bumaba ng tubig', 'plumbing',
   'plumbing', 95, 'medium', 49, 'model', NULL, NULL, 'Taglish', 'awaiting_review', NULL, NULL, NULL, NULL, NULL),
  ('lumen.optical@example.com',  27, 'The glass door of our store does not lock properly anymore', 'structural',
   'structural', 88, 'medium', 52, 'model', NULL, NULL, 'English', 'awaiting_review', NULL, NULL, NULL, NULL, NULL),
  ('technest@example.com',       30, 'Naipit yung daliri ng staff namin sa roll-up door, natanggal na ang bracket', 'structural',
   'structural', 83, 'critical', 84, 'model', 'naipit', NULL, 'Taglish', 'awaiting_review', NULL, NULL, NULL, NULL, NULL),

  -- In progress
  ('demo.store@example.com',     30, 'Patay-sindi yung ilaw sa dining area simula kahapon', 'electrical',
   'electrical', 98, 'medium', 47, 'model', NULL, NULL, 'Taglish', 'in_progress', 'demo.staff@example.com', 'electrical', 'medium', NULL, NULL),
  ('bahay.kusina@example.com',   50, 'Walang kuryente sa dalawang saksakan namin, hindi magamit ang rice cooker', 'electrical',
   'electrical', 97, 'medium', 51, 'model', NULL, NULL, 'Taglish', 'in_progress', 'demo.staff@example.com', 'electrical', 'high', 'Food stall cannot operate without these outlets.', NULL),
  ('ganda.salon@example.com',    54, 'Hindi lumalamig ang aircon kahit naka-max na', 'hvac',
   'hvac', 95, 'low', 33, 'model', NULL, NULL, 'Taglish', 'in_progress', 'ana.hvac@example.com', 'hvac', 'medium', 'Customers in chairs for hours; treat as Medium.', NULL),
  ('lumen.optical@example.com',  70, 'Leaking pipe under the sink in our stockroom', 'plumbing',
   'plumbing', 96, 'medium', 54, 'model', NULL, NULL, 'English', 'in_progress', 'jose.plumber@example.com', 'plumbing', 'medium', NULL, NULL),
  ('sole.republic@example.com',  75, 'May bitak na sa tiles sa harap ng pwesto, baka may madulas', 'structural',
   'structural', 86, 'medium', 46, 'model', NULL, NULL, 'Taglish', 'in_progress', 'paolo.general@example.com', 'structural', 'medium', NULL, NULL),
  ('technest@example.com',       96, 'Puno na ang basurahan sa likod ng tindahan, hindi pa nakukuha', 'housekeeping',
   'housekeeping', 93, 'low', 27, 'model', NULL, NULL, 'Taglish', 'in_progress', 'paolo.general@example.com', 'housekeeping', 'low', NULL, NULL),

  -- Resolved
  ('demo.store@example.com',     150, 'Sira ang flush ng CR ng staff namin', 'plumbing',
   'plumbing', 97, 'medium', 50, 'model', NULL, NULL, 'Taglish', 'resolved', 'jose.plumber@example.com', 'plumbing', 'medium', NULL, 0.9),
  ('demo.store@example.com',     420, 'May langgam at ipis sa storage area', 'housekeeping',
   'housekeeping', 91, 'low', 29, 'model', NULL, NULL, 'Taglish', 'resolved', 'paolo.general@example.com', 'housekeeping', 'low', NULL, 1.8),
  ('bahay.kusina@example.com',   190, 'Amoy gas sa may kusina namin, hindi namin alam kung saan galing', 'fire_safety',
   'fire_safety', 90, 'critical', 89, 'model', NULL, NULL, 'Taglish', 'resolved', 'paolo.general@example.com', 'fire_safety', 'critical', NULL, 0.2),
  ('lumen.optical@example.com',  220, 'Fire extinguisher in our store has expired', 'fire_safety',
   'fire_safety', 94, 'low', 34, 'model', NULL, NULL, 'English', 'resolved', 'paolo.general@example.com', 'fire_safety', 'medium', 'Expired extinguishers must be replaced the same day.', 1.1),
  ('ganda.salon@example.com',    260, 'Biglang namatay lahat ng ilaw at saksakan sa pwesto namin', 'electrical',
   'electrical', 96, 'high', 71, 'model', NULL, NULL, 'Taglish', 'resolved', 'demo.staff@example.com', 'electrical', 'high', NULL, 0.4),
  ('sole.republic@example.com',  300, 'Ang ingay ng exhaust fan namin, parang may kumakalampag', 'hvac',
   'hvac', 89, 'low', 30, 'model', NULL, NULL, 'Taglish', 'resolved', 'ana.hvac@example.com', 'hvac', 'low', NULL, 1.6),
  ('technest@example.com',       340, 'Water is dripping from the AC unit onto our display', 'hvac',
   'hvac', 92, 'medium', 55, 'model', NULL, NULL, 'English', 'resolved', 'ana.hvac@example.com', 'hvac', 'medium', NULL, 0.8),
  ('bahay.kusina@example.com',   380, 'Barado ang drainage sa food court, umaapaw na ang tubig', 'plumbing',
   'plumbing', 95, 'high', 69, 'model', NULL, NULL, 'Taglish', 'resolved', 'jose.plumber@example.com', 'plumbing', 'high', NULL, 0.5),
  ('lumen.optical@example.com',  450, 'Nakuryente po yung staff namin nung hinawakan yung switch', 'electrical',
   'electrical', 95, 'high', 60, 'safety_floor', 'nakuryente', 'medium', 'Taglish', 'resolved', 'demo.staff@example.com', 'electrical', 'critical', 'A person was shocked; Critical regardless of the model.', 0.3),
  ('ganda.salon@example.com',    500, 'Sira ang hawakan ng pinto ng CR', 'structural',
   'structural', 87, 'low', 32, 'model', NULL, NULL, 'Taglish', 'resolved', 'paolo.general@example.com', 'structural', 'low', NULL, 1.9),
  ('sole.republic@example.com',  540, 'May tumutulong tubig sa kisame kapag umuulan', 'plumbing',
   'plumbing', 90, 'medium', 52, 'model', NULL, NULL, 'Taglish', 'resolved', 'jose.plumber@example.com', 'structural', 'medium', 'Roof leak; handled as structural.', 1.0),
  ('technest@example.com',       600, 'Our smoke detector keeps beeping, battery might be low', 'fire_safety',
   'fire_safety', 93, 'low', 28, 'model', NULL, NULL, 'English', 'resolved', 'paolo.general@example.com', 'fire_safety', 'low', NULL, 1.4),
  ('bahay.kusina@example.com',   640, 'Walang tubig sa gripo ng stall namin buong umaga', 'plumbing',
   'plumbing', 96, 'high', 66, 'model', NULL, NULL, 'Taglish', 'resolved', 'jose.plumber@example.com', 'plumbing', 'high', NULL, 0.6),
  ('lumen.optical@example.com',  680, 'Ang dumi ng hallway sa harap ng store, may natapong softdrinks', 'housekeeping',
   'housekeeping', 95, 'low', 26, 'model', NULL, NULL, 'Taglish', 'resolved', 'paolo.general@example.com', 'housekeeping', 'low', NULL, 0.7),
  ('ganda.salon@example.com',    700, 'Umaapoy yung extension cord ng hair dryer namin kanina', 'electrical',
   'electrical', 97, 'critical', 90, 'model', 'apoy', NULL, 'Taglish', 'resolved', 'demo.staff@example.com', 'electrical', 'critical', NULL, 0.15);

INSERT INTO public.issues (
  tenant_id, store_name, contact_person, phone_number, text, category, status, assigned_to,
  ai_category, ai_confidence, ai_priority_level, ai_priority_score, ai_priority_source,
  ai_safety_terms, ai_model_priority, ai_language,
  validated, validated_by, validated_at, overridden, override_notes, pre_override_priority_level,
  submitted_at
)
SELECT
  t.id, t.store_name, t.contact_person, t.phone_number, r.body,
  coalesce(r.final_cat, r.picked),
  /* Resolved reports are inserted as in progress and resolved below, so
     their resolution time can be set to a point in the past. */
  CASE WHEN r.state = 'resolved' THEN 'in_progress' ELSE r.state END,
  s.id,
  r.ai_cat, r.conf, coalesce(r.final_lvl, r.ai_lvl), r.score, r.src,
  r.terms, r.model_lvl, r.lang,
  r.state <> 'awaiting_review',
  CASE WHEN r.state <> 'awaiting_review' THEN a.id END,
  CASE WHEN r.state <> 'awaiting_review' THEN now() - make_interval(secs => (r.age_h - 0.5) * 3600) END,
  r.final_cat IS NOT NULL AND (r.final_cat <> r.ai_cat OR r.final_lvl <> r.ai_lvl),
  r.notes,
  CASE WHEN r.final_lvl IS NOT NULL AND r.final_lvl <> r.ai_lvl THEN r.ai_lvl END,
  now() - make_interval(secs => r.age_h * 3600)
FROM demo_reports r
JOIN public.tenants t ON t.email = r.store
CROSS JOIN (SELECT id FROM auth.users WHERE email = 'demo.admin@example.com') a
LEFT JOIN auth.users s ON s.email = r.staff
ORDER BY r.age_h DESC;   -- oldest first, so ticket numbers follow submission order

-- Resolve, then move each resolution back to when it happened.
UPDATE public.issues i SET status = 'resolved'
FROM demo_reports r JOIN public.tenants t ON t.email = r.store
WHERE i.tenant_id = t.id AND i.text = r.body AND r.state = 'resolved';

UPDATE public.issues i
SET resolved_at = i.submitted_at + make_interval(secs => r.fix_h * 3600)
FROM demo_reports r JOIN public.tenants t ON t.email = r.store
WHERE i.tenant_id = t.id AND i.text = r.body AND r.state = 'resolved';


DROP TABLE demo_reports;


-- ---------- Check ----------
SELECT status, count(*) AS reports FROM public.issues GROUP BY status ORDER BY status;


-- ---------- Resetting passwords (optional) ----------
/* If a visitor changes a demo account's password, set it back with the
   statement below, replacing NEW-PASSWORD with the published one. It uses
   pgcrypto, which Supabase installs in the "extensions" schema.

   UPDATE auth.users
   SET encrypted_password = extensions.crypt('NEW-PASSWORD', extensions.gen_salt('bf'))
   WHERE email IN ('demo.admin@example.com', 'demo.staff@example.com', 'demo.store@example.com');
*/
