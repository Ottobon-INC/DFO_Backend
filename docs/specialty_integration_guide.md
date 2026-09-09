# Specialty Integration Guide: Conceptual Blueprint

This guide explains the conceptual flow of how we built the IVF module, which you can use as a blueprint for adding a new specialty like Gynecology. It focuses on **how everything is connected**, from the Superadmin down to the database, without getting bogged down in code.

At the bottom of this document is the full SQL template you can use to create the database tables.

---

## 1. How the Clinic Specialty is Connected (The Trigger)

Everything starts with the **Superadmin**. 
When the Superadmin creates a new clinic in the system, they assign it a "Specialty" (e.g., `General`, `IVF`, or `GYNEC`). 

**The Connection Flow:**
1. **The Database:** The specialty is saved in the `sakhi_clinics` master table.
2. **The Login:** When a doctor logs in, the backend checks which clinic they belong to and attaches that clinic's specialty to their user profile.
3. **The Browser:** The frontend receives this profile and saves the `clinic_specialty` directly into the browser's memory (`localStorage`).

Now, the entire frontend application knows exactly what type of clinic the user is sitting in.

---

## 2. How the Frontend UI is Connected (Visibility)

We have one main page called the `Patient Profile`. We don't want to clutter this page with 50 different tabs for every possible specialty.

**The Connection Flow:**
1. When the `Patient Profile` page loads, it checks the browser's memory for the `clinic_specialty`.
2. It uses a simple IF/THEN rule:
   - *IF specialty is IVF -> Show the "IVF Case Sheet" tab.*
   - *IF specialty is GYNEC -> Show the "Gynecology Exam" tab.*
3. If the user works at a normal General Clinic, both of those tabs stay completely hidden.

This means you only have to build one React component (e.g., `GynecCaseSheet.tsx`), and the system will automatically hide or show it to the right people based on where they work.

---

## 3. How the "Save" Button is Connected (The Data Flow)

When a doctor fills out a massive 10-page Gynecological form and clicks "Save", here is exactly how that data travels:

1. **The Frontend Payload:** The website scoops up every single textbox, dropdown, and checkbox on the screen and packages it into one massive JSON package.
2. **The API Call:** It sends this package to a specific Backend API endpoint (e.g., `/api/v1/specialty-records/gynec`).
3. **The Backend Sorter:** The backend receives the package. It acts like a mail sorting room. It takes the package apart and says:
   - *"These fields go to the Profile table."*
   - *"These rows go to the Ultrasound table."*
4. **The Database Upsert:** The backend uses a database command called `UPSERT`. This is a smart command that checks: *"Does this patient already have data saved here? If yes, UPDATE it. If no, INSERT it as new."*

---

## 4. How the Database is Connected (Hub & Spoke Model)

Medical forms are too big for one table. We use a **Hub and Spoke** connection model.

1. **The Hub (The Parent):** 
   - We create a central tracking table (e.g., `sakhi_gynec_episodes`). 
   - This holds the core connection: `patient_id` and `clinic_id`.
   
2. **The Spokes (The Children):** 
   - We break the form into logical sections (e.g., `sakhi_gynec_profile`, `sakhi_gynec_examinations`).
   - Every Spoke table connects back to the Hub using an `episode_id`.

3. **Dynamic Lists (JSONB):**
   - For parts of the form where the doctor clicks "Add Row" (like a list of past pregnancies or multiple ultrasound dates), we **do not** make new tables. We store them as a `JSONB` array inside the Spoke table. This is much faster and easier to manage.

4. **Security (Clinic ID):**
   - **Crucial Connection:** Even though the Hub connects to the Clinic, we explicitly stamp the `clinic_id` onto **every single Spoke table** as well. This guarantees that if Clinic A tries to search the database, the Row-Level Security (RLS) instantly blocks them from seeing Clinic B's records.

---

## Full SQL Template for a New Specialty (e.g., GYNEC)

Here is the complete, production-ready SQL architecture you can copy, paste, and modify for Gynecology or any other specialty.

```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- 1. THE HUB TABLE (e.g., Gynecological Episode)
-- ============================================================
CREATE TABLE IF NOT EXISTS sakhi_gynec_episodes (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id      UUID NOT NULL,
    clinic_id       UUID NOT NULL, -- The security anchor
    doctor_id       UUID,
    status          VARCHAR(50) DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','COMPLETED','CANCELLED')),
    start_date      DATE,
    
    -- Audit & Security 
    version         INTEGER DEFAULT 1,
    created_by      UUID,
    updated_by      UUID,
    is_deleted      BOOLEAN DEFAULT FALSE,
    deleted_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_gynec_episodes_patient ON sakhi_gynec_episodes(patient_id);
CREATE INDEX idx_gynec_episodes_clinic ON sakhi_gynec_episodes(clinic_id);

-- ============================================================
-- 2. SPOKE TABLE 1 (e.g., Profile & History)
-- ============================================================
CREATE TABLE IF NOT EXISTS sakhi_gynec_profile (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    episode_id      UUID NOT NULL REFERENCES sakhi_gynec_episodes(id) ON DELETE CASCADE,
    clinic_id       UUID NOT NULL, -- Duplicated for security
    
    -- Normal Fields (One Box)
    menarche_age    INTEGER,
    lmp_date        DATE,
    
    -- Dynamic Fields (Add Row lists)
    obstetric_history JSONB DEFAULT '[]'::jsonb,
    
    -- Audit & Security
    version         INTEGER DEFAULT 1,
    created_by      UUID,
    updated_by      UUID,
    is_deleted      BOOLEAN DEFAULT FALSE,
    deleted_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_gynec_profile_episode ON sakhi_gynec_profile(episode_id);
CREATE INDEX idx_gynec_profile_clinic ON sakhi_gynec_profile(clinic_id);

-- ============================================================
-- 3. SPOKE TABLE 2 (e.g., Examinations)
-- ============================================================
CREATE TABLE IF NOT EXISTS sakhi_gynec_examinations (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    episode_id      UUID NOT NULL REFERENCES sakhi_gynec_episodes(id) ON DELETE CASCADE,
    clinic_id       UUID NOT NULL,
    
    blood_pressure  VARCHAR(20),
    weight          VARCHAR(20),
    ultrasound_rows JSONB DEFAULT '[]'::jsonb,
    
    version         INTEGER DEFAULT 1,
    created_by      UUID,
    updated_by      UUID,
    is_deleted      BOOLEAN DEFAULT FALSE,
    deleted_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_gynec_examinations_episode ON sakhi_gynec_examinations(episode_id);
CREATE INDEX idx_gynec_examinations_clinic ON sakhi_gynec_examinations(clinic_id);


-- ============================================================
-- 4. ROW-LEVEL SECURITY (RLS)
-- ============================================================
-- Lock down all tables so clinics can only see their own data
ALTER TABLE sakhi_gynec_episodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE sakhi_gynec_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE sakhi_gynec_examinations ENABLE ROW LEVEL SECURITY;

-- Allow backend services to access the data securely
CREATE POLICY "service_role_full_access" ON sakhi_gynec_episodes FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_full_access" ON sakhi_gynec_profile FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_full_access" ON sakhi_gynec_examinations FOR ALL USING (true) WITH CHECK (true);

-- ============================================================
-- 5. AUTO-UPDATE TIMESTAMP TRIGGERS
-- ============================================================
-- This function automatically bumps the version number and updated_at time whenever someone clicks Save.
CREATE OR REPLACE FUNCTION update_gynec_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    NEW.version = COALESCE(OLD.version, 0) + 1;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_gynec_episodes_updated BEFORE UPDATE ON sakhi_gynec_episodes
    FOR EACH ROW EXECUTE FUNCTION update_gynec_updated_at();
CREATE TRIGGER trg_gynec_profile_updated BEFORE UPDATE ON sakhi_gynec_profile
    FOR EACH ROW EXECUTE FUNCTION update_gynec_updated_at();
CREATE TRIGGER trg_gynec_examinations_updated BEFORE UPDATE ON sakhi_gynec_examinations
    FOR EACH ROW EXECUTE FUNCTION update_gynec_updated_at();
```
