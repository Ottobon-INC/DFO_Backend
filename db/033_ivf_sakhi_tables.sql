-- ============================================================
-- IVF SAKHI DATABASE SCHEMA — Production Ready
-- Run this ENTIRE file in Supabase SQL Editor in one go
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- TABLE 1: sakhi_ivf_cycles (Central Hub)
-- ============================================================
CREATE TABLE IF NOT EXISTS sakhi_ivf_cycles (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id      UUID NOT NULL,
    clinic_id       UUID NOT NULL,
    doctor_id       UUID,
    cycle_number    INTEGER DEFAULT 1,
    status          VARCHAR(50) DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','COMPLETED','CANCELLED','ON_HOLD')),
    start_date      DATE,
    end_date        DATE,
    version         INTEGER DEFAULT 1,
    created_by      UUID,
    updated_by      UUID,
    is_deleted      BOOLEAN DEFAULT FALSE,
    deleted_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sakhi_ivf_cycles_patient ON sakhi_ivf_cycles(patient_id);
CREATE INDEX idx_sakhi_ivf_cycles_clinic ON sakhi_ivf_cycles(clinic_id);
CREATE INDEX idx_sakhi_ivf_cycles_active ON sakhi_ivf_cycles(patient_id, clinic_id) WHERE is_deleted = FALSE;

-- ============================================================
-- TABLE 2: sakhi_ivf_female_profile (Pages 1 + 2)
-- ============================================================
CREATE TABLE IF NOT EXISTS sakhi_ivf_female_profile (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    cycle_id        UUID NOT NULL REFERENCES sakhi_ivf_cycles(id) ON DELETE CASCADE UNIQUE,
    clinic_id       UUID NOT NULL,
    education       VARCHAR(200),
    occupation      VARCHAR(200),
    marital_life_years VARCHAR(20),
    age_of_menarche VARCHAR(20),
    periods         VARCHAR(50),
    lmp             DATE,
    flow            VARCHAR(50),
    dysmenorrhoea   VARCHAR(50),
    premenstrual_spotting VARCHAR(50),
    intermenstrual_bleeding VARCHAR(50),
    bowels          VARCHAR(100),
    consanguinity   VARCHAR(50),
    weight_gain     VARCHAR(100),
    freq_of_ic      VARCHAR(100),
    dyspareunia     VARCHAR(50),
    loss_of_libido  VARCHAR(50),
    obstetric_history JSONB DEFAULT '[]'::jsonb,
    past_medical    TEXT,
    drug_allergy    TEXT,
    family_history  TEXT,
    surgical_history TEXT,
    treatment_history TEXT,
    prev_ivf_details TEXT,
    exam_date       DATE,
    exam_ht         VARCHAR(20),
    exam_wt         VARCHAR(20),
    exam_bmi        VARCHAR(20),
    exam_bp         VARCHAR(20),
    acne            VARCHAR(50),
    hirsutism       VARCHAR(50),
    acanthosis      VARCHAR(50),
    breasts         VARCHAR(100),
    galactorrhoea   VARCHAR(50),
    fg_score        VARCHAR(20),
    version         INTEGER DEFAULT 1,
    created_by      UUID,
    updated_by      UUID,
    is_deleted      BOOLEAN DEFAULT FALSE,
    deleted_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sakhi_ivf_female_profile_cycle ON sakhi_ivf_female_profile(cycle_id);
CREATE INDEX idx_sakhi_ivf_female_profile_clinic ON sakhi_ivf_female_profile(clinic_id);

-- ============================================================
-- TABLE 3: sakhi_ivf_procedures (Page 3)
-- ============================================================
CREATE TABLE IF NOT EXISTS sakhi_ivf_procedures (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    cycle_id        UUID NOT NULL REFERENCES sakhi_ivf_cycles(id) ON DELETE CASCADE UNIQUE,
    clinic_id       UUID NOT NULL,
    hsg_rows        JSONB DEFAULT '[]'::jsonb,
    hysteroscopy_rows JSONB DEFAULT '[]'::jsonb,
    laparoscopy_rows  JSONB DEFAULT '[]'::jsonb,
    version         INTEGER DEFAULT 1,
    created_by      UUID,
    updated_by      UUID,
    is_deleted      BOOLEAN DEFAULT FALSE,
    deleted_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sakhi_ivf_procedures_cycle ON sakhi_ivf_procedures(cycle_id);
CREATE INDEX idx_sakhi_ivf_procedures_clinic ON sakhi_ivf_procedures(clinic_id);

-- ============================================================
-- TABLE 4: sakhi_ivf_lab_panels (Pages 4 + Male Blood Page 9)
-- ============================================================
CREATE TABLE IF NOT EXISTS sakhi_ivf_lab_panels (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    cycle_id        UUID NOT NULL REFERENCES sakhi_ivf_cycles(id) ON DELETE CASCADE UNIQUE,
    clinic_id       UUID NOT NULL,
    panel_type      VARCHAR(50) NOT NULL CHECK (panel_type IN ('FEMALE','MALE')),
    dates           JSONB DEFAULT '[]'::jsonb,
    lab_rows        JSONB DEFAULT '[]'::jsonb,
    antithyroid_antibodies      VARCHAR(200),
    antimicrosomial_antibodies  VARCHAR(200),
    version         INTEGER DEFAULT 1,
    created_by      UUID,
    updated_by      UUID,
    is_deleted      BOOLEAN DEFAULT FALSE,
    deleted_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sakhi_ivf_lab_panels_cycle ON sakhi_ivf_lab_panels(cycle_id);
CREATE INDEX idx_sakhi_ivf_lab_panels_clinic ON sakhi_ivf_lab_panels(clinic_id);
CREATE INDEX idx_sakhi_ivf_lab_panels_type ON sakhi_ivf_lab_panels(panel_type);

-- ============================================================
-- TABLE 5: sakhi_ivf_baseline_usg (Page 5)
-- ============================================================
CREATE TABLE IF NOT EXISTS sakhi_ivf_baseline_usg (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    cycle_id        UUID NOT NULL REFERENCES sakhi_ivf_cycles(id) ON DELETE CASCADE UNIQUE,
    clinic_id       UUID NOT NULL,
    usg_date        DATE,
    day_of_mc       VARCHAR(20),
    uterus_type     VARCHAR(50),
    uterus_size     VARCHAR(50),
    uterus_vol      VARCHAR(50),
    emzj            VARCHAR(100),
    usg_3d_4d       VARCHAR(200),
    rt_ut_ri        VARCHAR(20),
    rt_ut_pi        VARCHAR(20),
    rt_ut_comment   VARCHAR(200),
    lt_ut_ri        VARCHAR(20),
    lt_ut_pi        VARCHAR(20),
    lt_ut_comment   VARCHAR(200),
    rt_ovary_size   VARCHAR(50),
    rt_ovary_vol    VARCHAR(50),
    rt_ovary_access VARCHAR(50),
    rt_ovary_paf    VARCHAR(50),
    rt_ovary_comment VARCHAR(200),
    lt_ovary_size   VARCHAR(50),
    lt_ovary_vol    VARCHAR(50),
    lt_ovary_access VARCHAR(50),
    lt_ovary_paf    VARCHAR(50),
    lt_ovary_comment VARCHAR(200),
    version         INTEGER DEFAULT 1,
    created_by      UUID,
    updated_by      UUID,
    is_deleted      BOOLEAN DEFAULT FALSE,
    deleted_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sakhi_ivf_baseline_usg_cycle ON sakhi_ivf_baseline_usg(cycle_id);
CREATE INDEX idx_sakhi_ivf_baseline_usg_clinic ON sakhi_ivf_baseline_usg(clinic_id);

-- ============================================================
-- TABLE 6: sakhi_ivf_male_profile (Page 6)
-- ============================================================
CREATE TABLE IF NOT EXISTS sakhi_ivf_male_profile (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    cycle_id        UUID NOT NULL REFERENCES sakhi_ivf_cycles(id) ON DELETE CASCADE UNIQUE,
    clinic_id       UUID NOT NULL,
    name            VARCHAR(200),
    age             VARCHAR(10),
    height          VARCHAR(20),
    weight          VARCHAR(20),
    bmi             VARCHAR(20),
    occupation      VARCHAR(200),
    smoking         VARCHAR(50),
    alcohol         VARCHAR(50),
    pan_parag       VARCHAR(50),
    retrograde_ejaculation  VARCHAR(50),
    premature_ejaculation   VARCHAR(50),
    erectile_dysfunction    VARCHAR(50),
    loss_of_libido          VARCHAR(50),
    medical_history     TEXT,
    surgical_history    TEXT,
    treatment_history   TEXT,
    family_ht           VARCHAR(50),
    family_dm           VARCHAR(50),
    family_hypothyroid  VARCHAR(50),
    urologist_opinion   TEXT,
    version         INTEGER DEFAULT 1,
    created_by      UUID,
    updated_by      UUID,
    is_deleted      BOOLEAN DEFAULT FALSE,
    deleted_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sakhi_ivf_male_profile_cycle ON sakhi_ivf_male_profile(cycle_id);
CREATE INDEX idx_sakhi_ivf_male_profile_clinic ON sakhi_ivf_male_profile(clinic_id);

-- ============================================================
-- TABLE 7: sakhi_ivf_semen_analysis (Pages 7 + 8 + 9)
-- ============================================================
CREATE TABLE IF NOT EXISTS sakhi_ivf_semen_analysis (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    cycle_id        UUID NOT NULL REFERENCES sakhi_ivf_cycles(id) ON DELETE CASCADE UNIQUE,
    clinic_id       UUID NOT NULL,
    semen_count         VARCHAR(50),
    progressive_a_pct   VARCHAR(20),
    progressive_a_conc  VARCHAR(20),
    sluggish_b_pct      VARCHAR(20),
    sluggish_b_conc     VARCHAR(20),
    non_progressive_c_pct  VARCHAR(20),
    non_progressive_c_conc VARCHAR(20),
    static_d_pct        VARCHAR(20),
    static_d_conc       VARCHAR(20),
    type_ab_pct         VARCHAR(20),
    type_ab_conc        VARCHAR(20),
    morph_normal_pct    VARCHAR(20),
    morph_normal_conc   VARCHAR(20),
    morph_abnormal_pct  VARCHAR(20),
    morph_abnormal_conc VARCHAR(20),
    morph_head_pct      VARCHAR(20),
    morph_head_conc     VARCHAR(20),
    morph_mid_pct       VARCHAR(20),
    morph_mid_conc      VARCHAR(20),
    morph_tail_pct      VARCHAR(20),
    morph_tail_conc     VARCHAR(20),
    terato_index_pct    VARCHAR(20),
    terato_index_conc   VARCHAR(20),
    fragmented          VARCHAR(20),
    non_fragmented      VARCHAR(20),
    dfi_value           VARCHAR(20),
    dna_impression      TEXT,
    male_usg_date           DATE,
    testicular_biopsy_date  DATE,
    semen_comparison_rows   JSONB DEFAULT '[]'::jsonb,
    version         INTEGER DEFAULT 1,
    created_by      UUID,
    updated_by      UUID,
    is_deleted      BOOLEAN DEFAULT FALSE,
    deleted_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sakhi_ivf_semen_analysis_cycle ON sakhi_ivf_semen_analysis(cycle_id);
CREATE INDEX idx_sakhi_ivf_semen_analysis_clinic ON sakhi_ivf_semen_analysis(clinic_id);

-- ============================================================
-- TABLE 8: sakhi_ivf_treatment_tracking (Pages 10 + 11 + 12)
-- ============================================================
CREATE TABLE IF NOT EXISTS sakhi_ivf_treatment_tracking (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    cycle_id        UUID NOT NULL REFERENCES sakhi_ivf_cycles(id) ON DELETE CASCADE UNIQUE,
    clinic_id       UUID NOT NULL,
    tubal_factor            VARCHAR(200),
    ovarian_factor          VARCHAR(200),
    uterine_factor          VARCHAR(200),
    unexplained_infertility VARCHAR(200),
    hormones_comment        TEXT,
    sa_casa_comments        TEXT,
    dna_frag_summary        TEXT,
    medical_disorder        TEXT,
    protocol_steps          JSONB DEFAULT '[]'::jsonb,
    counselling_date        DATE,
    cost_explained          BOOLEAN DEFAULT FALSE,
    risk_explained          BOOLEAN DEFAULT FALSE,
    success_rate_explained  BOOLEAN DEFAULT FALSE,
    fm_date                 DATE,
    fm_wt                   VARCHAR(20),
    fm_bmi                  VARCHAR(20),
    fm_diagnosis            TEXT,
    fm_protocol             TEXT,
    follicular_rows         JSONB DEFAULT '[]'::jsonb,
    version         INTEGER DEFAULT 1,
    created_by      UUID,
    updated_by      UUID,
    is_deleted      BOOLEAN DEFAULT FALSE,
    deleted_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sakhi_ivf_treatment_tracking_cycle ON sakhi_ivf_treatment_tracking(cycle_id);
CREATE INDEX idx_sakhi_ivf_treatment_tracking_clinic ON sakhi_ivf_treatment_tracking(clinic_id);

-- ============================================================
-- ROW-LEVEL SECURITY (RLS)
-- ============================================================
ALTER TABLE sakhi_ivf_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE sakhi_ivf_female_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE sakhi_ivf_procedures ENABLE ROW LEVEL SECURITY;
ALTER TABLE sakhi_ivf_lab_panels ENABLE ROW LEVEL SECURITY;
ALTER TABLE sakhi_ivf_baseline_usg ENABLE ROW LEVEL SECURITY;
ALTER TABLE sakhi_ivf_male_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE sakhi_ivf_semen_analysis ENABLE ROW LEVEL SECURITY;
ALTER TABLE sakhi_ivf_treatment_tracking ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access" ON sakhi_ivf_cycles FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_full_access" ON sakhi_ivf_female_profile FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_full_access" ON sakhi_ivf_procedures FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_full_access" ON sakhi_ivf_lab_panels FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_full_access" ON sakhi_ivf_baseline_usg FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_full_access" ON sakhi_ivf_male_profile FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_full_access" ON sakhi_ivf_semen_analysis FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_full_access" ON sakhi_ivf_treatment_tracking FOR ALL USING (true) WITH CHECK (true);

-- ============================================================
-- AUTO-UPDATE TRIGGER (version + updated_at)
-- ============================================================
CREATE OR REPLACE FUNCTION update_sakhi_ivf_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    NEW.version = COALESCE(OLD.version, 0) + 1;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sakhi_ivf_cycles_updated BEFORE UPDATE ON sakhi_ivf_cycles
    FOR EACH ROW EXECUTE FUNCTION update_sakhi_ivf_updated_at();
CREATE TRIGGER trg_sakhi_ivf_female_profile_updated BEFORE UPDATE ON sakhi_ivf_female_profile
    FOR EACH ROW EXECUTE FUNCTION update_sakhi_ivf_updated_at();
CREATE TRIGGER trg_sakhi_ivf_procedures_updated BEFORE UPDATE ON sakhi_ivf_procedures
    FOR EACH ROW EXECUTE FUNCTION update_sakhi_ivf_updated_at();
CREATE TRIGGER trg_sakhi_ivf_lab_panels_updated BEFORE UPDATE ON sakhi_ivf_lab_panels
    FOR EACH ROW EXECUTE FUNCTION update_sakhi_ivf_updated_at();
CREATE TRIGGER trg_sakhi_ivf_baseline_usg_updated BEFORE UPDATE ON sakhi_ivf_baseline_usg
    FOR EACH ROW EXECUTE FUNCTION update_sakhi_ivf_updated_at();
CREATE TRIGGER trg_sakhi_ivf_male_profile_updated BEFORE UPDATE ON sakhi_ivf_male_profile
    FOR EACH ROW EXECUTE FUNCTION update_sakhi_ivf_updated_at();
CREATE TRIGGER trg_sakhi_ivf_semen_analysis_updated BEFORE UPDATE ON sakhi_ivf_semen_analysis
    FOR EACH ROW EXECUTE FUNCTION update_sakhi_ivf_updated_at();
CREATE TRIGGER trg_sakhi_ivf_treatment_tracking_updated BEFORE UPDATE ON sakhi_ivf_treatment_tracking
    FOR EACH ROW EXECUTE FUNCTION update_sakhi_ivf_updated_at();

-- ============================================================
-- DONE! All 8 ivf_sakhi tables created successfully.
-- ============================================================
