-- ============================================================
-- RPS Construction Department Module — Step 1 Migration
-- Creates all con_* tables, RLS, numbering, role CHECK update.
-- Run this entire file in the Supabase SQL Editor.
-- Safe to re-run (uses IF NOT EXISTS / CREATE OR REPLACE / guarded drops).
-- ============================================================

-- ------------------------------------------------------------
-- 0. Shared helper: auto-update updated_at (already exists in
--    base schema; CREATE OR REPLACE is harmless if so).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ------------------------------------------------------------
-- 1. Extend the profiles.role CHECK to allow the two new
--    construction roles. We drop whatever CHECK currently
--    governs the role column (its name may have changed over
--    time) and recreate it with the full known set + new roles.
--    This preserves all roles the app already uses.
-- ------------------------------------------------------------
DO $$
DECLARE
  c text;
BEGIN
  SELECT conname INTO c
  FROM pg_constraint
  WHERE conrelid = 'public.profiles'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%role%';
  IF c IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.profiles DROP CONSTRAINT ' || quote_ident(c);
  END IF;
END $$;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check CHECK (role IN (
    'owner','manager','shop_manager','shop_employee',
    'mechanic','service_tech','construction_tech','office_staff',
    'viewer','construction_manager','estimator'
  ));

-- ------------------------------------------------------------
-- 2. RLS helper functions for the construction module.
--    SECURITY DEFINER so policies stay readable across tables.
--      con_user_company_id() -> the caller's company_id
--      con_can_read()        -> caller may READ construction data
--      con_can_write()       -> caller may WRITE construction data
--    shop_employee / shop / office roles get NO construction access.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION con_user_company_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT company_id FROM profiles WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION con_can_read()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
      AND role IN ('owner','manager','construction_manager','estimator','viewer')
  )
$$;

CREATE OR REPLACE FUNCTION con_can_write()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
      AND role IN ('owner','manager','construction_manager','estimator')
  )
$$;

-- ============================================================
-- 3. TABLES
-- ============================================================

-- ------------------------------------------------------------
-- con_customers
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS con_customers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies ON DELETE CASCADE,
  name            text NOT NULL,
  billing_contact text,
  email           text,
  phone           text,
  billing_address text,
  notes           text,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS con_customers_company_idx ON con_customers (company_id);
DROP TRIGGER IF EXISTS con_customers_updated_at ON con_customers;
CREATE TRIGGER con_customers_updated_at BEFORE UPDATE ON con_customers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
ALTER TABLE con_customers ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- con_sites
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS con_sites (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies ON DELETE CASCADE,
  customer_id     uuid REFERENCES con_customers ON DELETE SET NULL,
  site_number     text NOT NULL,
  store_brand     text,
  address         text,
  city            text,
  state           text,
  zip             text,
  dispenser_count integer,
  notes           text,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS con_sites_company_idx     ON con_sites (company_id);
CREATE INDEX IF NOT EXISTS con_sites_site_number_idx ON con_sites (site_number);
CREATE INDEX IF NOT EXISTS con_sites_customer_idx    ON con_sites (customer_id);
DROP TRIGGER IF EXISTS con_sites_updated_at ON con_sites;
CREATE TRIGGER con_sites_updated_at BEFORE UPDATE ON con_sites
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
ALTER TABLE con_sites ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- con_jobs  (the pipeline — replaces the "Job List")
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS con_jobs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL REFERENCES companies ON DELETE CASCADE,
  site_id             uuid REFERENCES con_sites ON DELETE SET NULL,
  site_number         text,
  customer_id         uuid REFERENCES con_customers ON DELETE SET NULL,
  work_order_number   text,
  stage               text NOT NULL DEFAULT 'survey' CHECK (stage IN (
                        'survey','quoting','permitting','material_ordering','needs_scheduled',
                        'scheduled','in_progress','on_hold','return_needed','close_out',
                        'invoicing','complete')),
  status_detail       text,
  scope_of_work       text,
  facility_address    text,
  gas_brand           text,
  program             text,
  priority            text DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  date_received       date,
  project_start_date  date,
  response_time       text,
  assigned_manager_id uuid REFERENCES profiles ON DELETE SET NULL,
  notes               text,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS con_jobs_company_idx     ON con_jobs (company_id);
CREATE INDEX IF NOT EXISTS con_jobs_stage_idx       ON con_jobs (stage);
CREATE INDEX IF NOT EXISTS con_jobs_customer_idx    ON con_jobs (customer_id);
CREATE INDEX IF NOT EXISTS con_jobs_site_number_idx ON con_jobs (site_number);
DROP TRIGGER IF EXISTS con_jobs_updated_at ON con_jobs;
CREATE TRIGGER con_jobs_updated_at BEFORE UPDATE ON con_jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
ALTER TABLE con_jobs ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- con_quotes  (proposals)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS con_quotes (
  id                           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                   uuid NOT NULL REFERENCES companies ON DELETE CASCADE,
  job_id                       uuid REFERENCES con_jobs ON DELETE SET NULL,
  quote_number                 text,
  proposal_date                date,
  customer_id                  uuid REFERENCES con_customers ON DELETE SET NULL,
  attn                         text,
  customer_email               text,
  store_label                  text,
  facility_address             text,
  city_state_zip               text,
  project_description          text,
  profit_overhead_percent      numeric DEFAULT 0,
  sales_tax_percent            numeric DEFAULT 0,
  basic_subtotal_material      numeric DEFAULT 0,
  basic_subtotal_labor         numeric DEFAULT 0,
  basic_total                  numeric DEFAULT 0,
  additional_subtotal_material numeric DEFAULT 0,
  additional_subtotal_labor    numeric DEFAULT 0,
  additional_total             numeric DEFAULT 0,
  grand_total                  numeric DEFAULT 0,
  profit_overhead_amount       numeric DEFAULT 0,
  tax_amount                   numeric DEFAULT 0,
  final_total                  numeric DEFAULT 0,
  status                       text DEFAULT 'draft' CHECK (status IN ('draft','sent','approved','rejected')),
  prepared_by                  text DEFAULT 'Starsky Dodson, Construction Manager',
  sent_date                    date,
  decision_date                date,
  created_at                   timestamptz DEFAULT now(),
  updated_at                   timestamptz DEFAULT now(),
  UNIQUE (company_id, quote_number)
);
CREATE INDEX IF NOT EXISTS con_quotes_company_idx ON con_quotes (company_id);
CREATE INDEX IF NOT EXISTS con_quotes_job_idx     ON con_quotes (job_id);
DROP TRIGGER IF EXISTS con_quotes_updated_at ON con_quotes;
CREATE TRIGGER con_quotes_updated_at BEFORE UPDATE ON con_quotes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
ALTER TABLE con_quotes ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- con_quote_line_items
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS con_quote_line_items (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id             uuid NOT NULL REFERENCES con_quotes ON DELETE CASCADE,
  section              text CHECK (section IN ('basic','additional')),
  line_no              integer,
  description          text,
  quantity             numeric,
  unit_cost            numeric,
  material_total       numeric,
  labor_hours          numeric,
  labor_rate           numeric,
  total_labor          numeric,
  total_material_labor numeric,
  item_type            text,
  is_stock             boolean DEFAULT false,
  created_at           timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS con_quote_line_items_quote_idx ON con_quote_line_items (quote_id);
ALTER TABLE con_quote_line_items ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- con_invoices
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS con_invoices (
  id                           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                   uuid NOT NULL REFERENCES companies ON DELETE CASCADE,
  job_id                       uuid REFERENCES con_jobs ON DELETE SET NULL,
  quote_id                     uuid REFERENCES con_quotes ON DELETE SET NULL,
  invoice_number               text,
  invoice_date                 date,
  csr_number                   text,
  po_number                    text,
  customer_id                  uuid REFERENCES con_customers ON DELETE SET NULL,
  attn                         text,
  store_label                  text,
  facility_address             text,
  city_state_zip               text,
  project_description          text,
  profit_overhead_percent      numeric DEFAULT 0,
  sales_tax_percent            numeric DEFAULT 0,
  basic_subtotal_material      numeric DEFAULT 0,
  basic_subtotal_labor         numeric DEFAULT 0,
  basic_total                  numeric DEFAULT 0,
  additional_subtotal_material numeric DEFAULT 0,
  additional_subtotal_labor    numeric DEFAULT 0,
  additional_total             numeric DEFAULT 0,
  grand_total                  numeric DEFAULT 0,
  profit_overhead_amount       numeric DEFAULT 0,
  tax_amount                   numeric DEFAULT 0,
  invoice_grand_total          numeric DEFAULT 0,
  status                       text DEFAULT 'draft' CHECK (status IN ('draft','sent','paid','overdue','void')),
  sent_date                    date,
  due_date                     date,
  paid_date                    date,
  prepared_by                  text DEFAULT 'Starsky Dodson, Construction Manager',
  created_at                   timestamptz DEFAULT now(),
  updated_at                   timestamptz DEFAULT now(),
  UNIQUE (company_id, invoice_number)
);
CREATE INDEX IF NOT EXISTS con_invoices_company_idx ON con_invoices (company_id);
CREATE INDEX IF NOT EXISTS con_invoices_job_idx     ON con_invoices (job_id);
CREATE INDEX IF NOT EXISTS con_invoices_quote_idx   ON con_invoices (quote_id);
DROP TRIGGER IF EXISTS con_invoices_updated_at ON con_invoices;
CREATE TRIGGER con_invoices_updated_at BEFORE UPDATE ON con_invoices
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
ALTER TABLE con_invoices ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- con_invoice_line_items  (identical shape to quote line items)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS con_invoice_line_items (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id           uuid NOT NULL REFERENCES con_invoices ON DELETE CASCADE,
  section              text CHECK (section IN ('basic','additional')),
  line_no              integer,
  description          text,
  quantity             numeric,
  unit_cost            numeric,
  material_total       numeric,
  labor_hours          numeric,
  labor_rate           numeric,
  total_labor          numeric,
  total_material_labor numeric,
  item_type            text,
  is_stock             boolean DEFAULT false,
  created_at           timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS con_invoice_line_items_invoice_idx ON con_invoice_line_items (invoice_id);
ALTER TABLE con_invoice_line_items ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- con_job_materials
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS con_job_materials (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES companies ON DELETE CASCADE,
  job_id        uuid NOT NULL REFERENCES con_jobs ON DELETE CASCADE,
  item_number   text,
  part_number   text,
  description   text,
  quantity      numeric,
  unit_cost     numeric,
  status        text DEFAULT 'needed' CHECK (status IN ('needed','ordered','received','in_stock')),
  vendor        text,
  ordered_date  date,
  received_date date,
  notes         text,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS con_job_materials_company_idx ON con_job_materials (company_id);
CREATE INDEX IF NOT EXISTS con_job_materials_job_idx     ON con_job_materials (job_id);
CREATE INDEX IF NOT EXISTS con_job_materials_status_idx  ON con_job_materials (status);
DROP TRIGGER IF EXISTS con_job_materials_updated_at ON con_job_materials;
CREATE TRIGGER con_job_materials_updated_at BEFORE UPDATE ON con_job_materials
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
ALTER TABLE con_job_materials ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- con_schedule_entries  (weekly crew dispatch)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS con_schedule_entries (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES companies ON DELETE CASCADE,
  schedule_date    date NOT NULL,
  job_id           uuid REFERENCES con_jobs ON DELETE SET NULL,
  site_number      text,
  task_description text,
  crew             text[],
  equipment        text,
  notes            text,
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS con_schedule_entries_company_idx ON con_schedule_entries (company_id);
CREATE INDEX IF NOT EXISTS con_schedule_entries_date_idx    ON con_schedule_entries (schedule_date);
DROP TRIGGER IF EXISTS con_schedule_entries_updated_at ON con_schedule_entries;
CREATE TRIGGER con_schedule_entries_updated_at BEFORE UPDATE ON con_schedule_entries
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
ALTER TABLE con_schedule_entries ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- con_job_labor  (optional manual labor log per job)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS con_job_labor (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies ON DELETE CASCADE,
  job_id      uuid NOT NULL REFERENCES con_jobs ON DELETE CASCADE,
  work_date   date,
  crew_member text,
  hours       numeric,
  labor_rate  numeric,
  task_note   text,
  created_at  timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS con_job_labor_company_idx ON con_job_labor (company_id);
CREATE INDEX IF NOT EXISTS con_job_labor_job_idx     ON con_job_labor (job_id);
ALTER TABLE con_job_labor ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- con_closeout_tasks  (punchlist / close-out checklist per job)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS con_closeout_tasks (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES companies ON DELETE CASCADE,
  job_id         uuid NOT NULL REFERENCES con_jobs ON DELETE CASCADE,
  task_name      text,
  is_complete    boolean DEFAULT false,
  completed_by   text,
  completed_date date,
  notes          text,
  created_at     timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS con_closeout_tasks_company_idx ON con_closeout_tasks (company_id);
CREATE INDEX IF NOT EXISTS con_closeout_tasks_job_idx     ON con_closeout_tasks (job_id);
DROP TRIGGER IF EXISTS con_closeout_tasks_updated_at ON con_closeout_tasks;
CREATE TRIGGER con_closeout_tasks_updated_at BEFORE UPDATE ON con_closeout_tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
ALTER TABLE con_closeout_tasks ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- con_documents  (attachments: permits, signed quotes, photos)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS con_documents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES companies ON DELETE CASCADE,
  job_id       uuid REFERENCES con_jobs ON DELETE CASCADE,
  quote_id     uuid REFERENCES con_quotes ON DELETE CASCADE,
  invoice_id   uuid REFERENCES con_invoices ON DELETE CASCADE,
  file_name    text,
  storage_path text,
  doc_type     text,
  uploaded_by  uuid REFERENCES profiles ON DELETE SET NULL,
  created_at   timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS con_documents_company_idx ON con_documents (company_id);
CREATE INDEX IF NOT EXISTS con_documents_job_idx     ON con_documents (job_id);
ALTER TABLE con_documents ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 4. AUTO-NUMBERING  (Q-YYYY-0001 / INV-YYYY-0001, per company)
-- ============================================================
CREATE OR REPLACE FUNCTION con_set_quote_number()
RETURNS TRIGGER AS $$
DECLARE
  yr  text := to_char(COALESCE(NEW.proposal_date, current_date), 'YYYY');
  seq integer;
BEGIN
  IF NEW.quote_number IS NULL OR NEW.quote_number = '' THEN
    PERFORM pg_advisory_xact_lock(hashtext('con_quote_' || NEW.company_id::text || '_' || yr));
    SELECT COALESCE(MAX(NULLIF(regexp_replace(quote_number, '^Q-\d{4}-', ''), '')::int), 0) + 1
      INTO seq
      FROM con_quotes
      WHERE company_id = NEW.company_id
        AND quote_number LIKE 'Q-' || yr || '-%';
    NEW.quote_number := 'Q-' || yr || '-' || LPAD(seq::text, 4, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS con_quotes_set_number ON con_quotes;
CREATE TRIGGER con_quotes_set_number BEFORE INSERT ON con_quotes
  FOR EACH ROW EXECUTE FUNCTION con_set_quote_number();

CREATE OR REPLACE FUNCTION con_set_invoice_number()
RETURNS TRIGGER AS $$
DECLARE
  yr  text := to_char(COALESCE(NEW.invoice_date, current_date), 'YYYY');
  seq integer;
BEGIN
  IF NEW.invoice_number IS NULL OR NEW.invoice_number = '' THEN
    PERFORM pg_advisory_xact_lock(hashtext('con_invoice_' || NEW.company_id::text || '_' || yr));
    SELECT COALESCE(MAX(NULLIF(regexp_replace(invoice_number, '^INV-\d{4}-', ''), '')::int), 0) + 1
      INTO seq
      FROM con_invoices
      WHERE company_id = NEW.company_id
        AND invoice_number LIKE 'INV-' || yr || '-%';
    NEW.invoice_number := 'INV-' || yr || '-' || LPAD(seq::text, 4, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS con_invoices_set_number ON con_invoices;
CREATE TRIGGER con_invoices_set_number BEFORE INSERT ON con_invoices
  FOR EACH ROW EXECUTE FUNCTION con_set_invoice_number();

-- ============================================================
-- 5. RLS POLICIES
--    Read  = owner/manager/construction_manager/estimator/viewer
--    Write = owner/manager/construction_manager/estimator
--    (shop_employee and other shop/office roles: no access)
-- ============================================================

-- Tables that carry company_id directly --------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'con_customers','con_sites','con_jobs','con_quotes','con_invoices',
    'con_job_materials','con_schedule_entries','con_job_labor',
    'con_closeout_tasks','con_documents'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_read',  t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_write', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT TO authenticated
         USING (company_id = con_user_company_id() AND con_can_read())',
      t || '_read', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL TO authenticated
         USING (company_id = con_user_company_id() AND con_can_write())
         WITH CHECK (company_id = con_user_company_id() AND con_can_write())',
      t || '_write', t);
  END LOOP;
END $$;

-- Line-item tables (scoped through their parent's company_id) ----------
DROP POLICY IF EXISTS con_quote_line_items_read  ON con_quote_line_items;
DROP POLICY IF EXISTS con_quote_line_items_write ON con_quote_line_items;
CREATE POLICY con_quote_line_items_read ON con_quote_line_items FOR SELECT TO authenticated
  USING (con_can_read() AND quote_id IN (SELECT id FROM con_quotes WHERE company_id = con_user_company_id()));
CREATE POLICY con_quote_line_items_write ON con_quote_line_items FOR ALL TO authenticated
  USING (con_can_write() AND quote_id IN (SELECT id FROM con_quotes WHERE company_id = con_user_company_id()))
  WITH CHECK (con_can_write() AND quote_id IN (SELECT id FROM con_quotes WHERE company_id = con_user_company_id()));

DROP POLICY IF EXISTS con_invoice_line_items_read  ON con_invoice_line_items;
DROP POLICY IF EXISTS con_invoice_line_items_write ON con_invoice_line_items;
CREATE POLICY con_invoice_line_items_read ON con_invoice_line_items FOR SELECT TO authenticated
  USING (con_can_read() AND invoice_id IN (SELECT id FROM con_invoices WHERE company_id = con_user_company_id()));
CREATE POLICY con_invoice_line_items_write ON con_invoice_line_items FOR ALL TO authenticated
  USING (con_can_write() AND invoice_id IN (SELECT id FROM con_invoices WHERE company_id = con_user_company_id()))
  WITH CHECK (con_can_write() AND invoice_id IN (SELECT id FROM con_invoices WHERE company_id = con_user_company_id()));

-- ============================================================
-- DONE. (Storage bucket "construction-docs" is created in the
-- Supabase dashboard — see the click-by-click steps in chat.)
-- ============================================================
