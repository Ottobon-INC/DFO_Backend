-- ============================================================
-- MIGRATION 035: IVF Ovarian Stimulation Monitoring Sheet
-- Run this in Supabase SQL Editor
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- TABLE: sakhi_ivf_stimulation_sheet
-- One row per IVF cycle (UNIQUE on cycle_id = Option A)
-- Mirrors the physical paper stimulation monitoring sheet
-- ============================================================
CREATE TABLE IF NOT EXISTS sakhi_ivf_stimulation_sheet (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    cycle_id                UUID NOT NULL REFERENCES sakhi_ivf_cycles(id) ON DELETE CASCADE UNIQUE,
    clinic_id               UUID NOT NULL,

    -- Header fields
    protocol                VARCHAR(100),           -- e.g. 'Agonist' or 'Antagonist'
    agonist_antagonist      VARCHAR(200),           -- specific protocol sub-type
    positive_negative       VARCHAR(50),            -- Positive / Negative indicator
    antithyroid_abs         VARCHAR(200),           -- Antithyroid Antibodies value

    -- E2 (Estradiol) levels at 3 checkpoints
    e2_level_note           VARCHAR(200),
    lh_level_note           VARCHAR(200),
    e2_day0                 VARCHAR(50),
    e2_day4                 VARCHAR(50),
    e2_day10                VARCHAR(50),

    -- LH levels at 3 checkpoints
    lh_day0                 VARCHAR(50),
    lh_day4                 VARCHAR(50),
    lh_day10                VARCHAR(50),

    -- P4 (Progesterone) value
    p4_value                VARCHAR(50),

    -- Daily log: JSONB array of 16 rows (Day 0 to Day 15)
    -- Each row shape: { day, date, e2, lh, drugs, rt_ov, lt_ov, em }
    daily_log               JSONB DEFAULT '[]'::jsonb,

    -- Footer / summary fields
    total_dose_fsh_lh_hmg   VARCHAR(200),           -- Total FSH + LH(HMG) dose consumed
    total_count             VARCHAR(200),           -- Total follicle/unit totals
    brand_name              VARCHAR(200),           -- Drug brand name
    given_by                VARCHAR(200),           -- Staff who administered injections

    -- HCG Trigger
    hcg_date                DATE,
    hcg_time                VARCHAR(20),

    -- OT / Egg Retrieval
    or_date                 DATE,
    or_time                 VARCHAR(20),

    -- Audit fields (same pattern as all other IVF tables)
    version                 INTEGER DEFAULT 1,
    created_by              UUID,
    updated_by              UUID,
    is_deleted              BOOLEAN DEFAULT FALSE,
    deleted_at              TIMESTAMPTZ,
    created_at              TIMESTAMPTZ DEFAULT NOW(),
    updated_at              TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_sakhi_ivf_stim_sheet_cycle
    ON sakhi_ivf_stimulation_sheet(cycle_id);

CREATE INDEX IF NOT EXISTS idx_sakhi_ivf_stim_sheet_clinic
    ON sakhi_ivf_stimulation_sheet(clinic_id);

-- Row-Level Security
ALTER TABLE sakhi_ivf_stimulation_sheet ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access" ON sakhi_ivf_stimulation_sheet
    FOR ALL USING (true) WITH CHECK (true);

-- Auto-update trigger (reuses the existing function from migration 033)
CREATE TRIGGER trg_sakhi_ivf_stim_sheet_updated
    BEFORE UPDATE ON sakhi_ivf_stimulation_sheet
    FOR EACH ROW EXECUTE FUNCTION update_sakhi_ivf_updated_at();

-- ============================================================
-- DONE! sakhi_ivf_stimulation_sheet created.
-- ============================================================
