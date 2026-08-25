# Hierarchical Role-Based Access Control (RBAC) Implementation Plan

## Goal Description
Implement a strict, hierarchical Role-Based Access Control (RBAC) system for a medical application's clinic-facing operations. The system will enforce a cascading permission model where higher-tier roles inherit permissions from lower-tier roles, while strictly preventing lower-tier roles from modifying higher-tier data. 

**Note on Super Admin:** The `Super Admin` role exists outside this hierarchy on the application/system end and does not interfere with the hospital-side RBAC.

**The Hospital-Side Hierarchy:**
- **Tier 1 (Doctor):** Full CRUD across all domains. Inherits Tier 2 & 3.
- **Tier 2 (Nurse):** Edit clinical nursing data (vitals). Read-only for Doctor data. Inherits Tier 3.
- **Tier 3 (Front Desk):** Edit administrative data (appointments). Read-only for all clinical data.

## Proposed Architecture

### 1. Database Schema Design (Supabase / PostgreSQL)

We will use an integer-based hierarchy to easily compute permission inheritance.

#### Roles & Users Table
```sql
-- Define the core roles as an ENUM or lookup table
CREATE TYPE user_role AS ENUM ('front_desk', 'nurse', 'doctor');

-- Extend the users table with role and hierarchy tier
ALTER TABLE public.users 
ADD COLUMN role user_role NOT NULL DEFAULT 'front_desk',
ADD COLUMN role_tier INT NOT NULL DEFAULT 3; -- 1: Doctor, 2: Nurse, 3: Front Desk

-- Function to automatically set role_tier based on role
CREATE OR REPLACE FUNCTION set_role_tier() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.role = 'doctor' THEN NEW.role_tier = 1;
  ELSIF NEW.role = 'nurse' THEN NEW.role_tier = 2;
  ELSE NEW.role_tier = 3;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_set_role_tier
BEFORE INSERT OR UPDATE ON public.users
FOR EACH ROW EXECUTE FUNCTION set_role_tier();
```

#### Resource Tables Categorization
Data tables will be conceptually grouped by the *minimum tier required to edit them*.
- **Admin Data (Tier 3 required):** `appointments`, `patients`
- **Nursing Data (Tier 2 required):** `vitals`, `triage_notes`
- **Doctor Data (Tier 1 required):** `prescriptions`, `diagnoses`, `clinical_notes`

---

### 2. Authorization Logic (Row Level Security & Backend Middleware)

#### Database Level: Supabase Row Level Security (RLS)
RLS policies will use the `role_tier` to enforce strict inheritance and read/write boundaries.

```sql
-- Example 1: Doctor Data (Prescriptions) - Tier 1
-- ANYONE can read (Tier >= 1)
CREATE POLICY "Anyone can view prescriptions" ON prescriptions
FOR SELECT USING (true);

-- ONLY Doctors (Tier <= 1) can edit/insert/delete
CREATE POLICY "Only Doctors can modify prescriptions" ON prescriptions
FOR ALL USING (
  (SELECT role_tier FROM users WHERE auth.uid() = id) <= 1
);

-- Example 2: Nursing Data (Vitals) - Tier 2
-- ANYONE can read
CREATE POLICY "Anyone can view vitals" ON vitals
FOR SELECT USING (true);

-- Nurses AND Doctors (Tier <= 2) can modify
CREATE POLICY "Nurses and Doctors can modify vitals" ON vitals
FOR ALL USING (
  (SELECT role_tier FROM users WHERE auth.uid() = id) <= 2
);

-- Example 3: Admin Data (Appointments) - Tier 3
-- ANYONE can read
CREATE POLICY "Anyone can view appointments" ON appointments
FOR SELECT USING (true);

-- Front Desk, Nurses, and Doctors (Tier <= 3) can modify
CREATE POLICY "Everyone can modify appointments" ON appointments
FOR ALL USING (
  (SELECT role_tier FROM users WHERE auth.uid() = id) <= 3
);
```

#### Backend Level: NestJS Guards (API Layer)
We will create a hierarchical role guard in NestJS to protect API endpoints.

```typescript
// roles.decorator.ts
export const MinRoleTier = (tier: number) => SetMetadata('minRoleTier', tier);

// roles.guard.ts
@Injectable()
export class HierarchicalRoleGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredTier = this.reflector.get<number>('minRoleTier', context.getHandler());
    if (!requiredTier) return true;

    const request = context.switchToHttp().getRequest();
    const userTier = request.user.role_tier; // Injected by JWT strategy

    // User tier must be LESS THAN OR EQUAL to required tier (1 is highest)
    if (userTier > requiredTier) {
       throw new ForbiddenException('You do not have permission to perform this action.');
    }
    return true;
  }
}
```

#### Audit Logging for Read-Only Access
As per compliance requirements, any cross-tier read access (e.g., a Front Desk user viewing a Prescription) will automatically trigger an audit log. We will implement an `AuditInterceptor` in NestJS that logs `VIEW` events when a successful `GET` request is made to sensitive clinical endpoints.

```typescript
// Example Controller Usage
@Post('prescriptions')
@UseGuards(JwtAuthGuard, HierarchicalRoleGuard)
@MinRoleTier(1) // Only Tier 1 (Doctor)
createPrescription() { ... }

@Post('vitals')
@UseGuards(JwtAuthGuard, HierarchicalRoleGuard)
@MinRoleTier(2) // Tier 1 (Doctor) and Tier 2 (Nurse)
logVitals() { ... }
```

---

### 3. Frontend Strategy (React)

The frontend will use a combination of a custom Hook and a Wrapper Component to hide or disable UI elements.

#### Context & Hook
```typescript
const usePermissions = () => {
  const { user } = useAuth(); // User object contains role_tier
  
  return {
    canEditClinical: user.role_tier <= 1,
    canEditNursing: user.role_tier <= 2,
    canEditAdmin: user.role_tier <= 3,
  };
};
```

#### Wrapper Component for UI Elements
Instead of littering the codebase with `if/else` statements, we use a declarative `RequireTier` component.

```tsx
export const RequireTier: React.FC<{ minTier: number, children: React.ReactNode, fallback?: React.ReactNode }> = ({ minTier, children, fallback = null }) => {
  const { user } = useAuth();
  
  if (user.role_tier <= minTier) {
    return <>{children}</>;
  }
  return <>{fallback}</>;
};
```

#### Implementation in Views
```tsx
// Doctor Prescription View
export const PrescriptionList = ({ patientId }) => {
  return (
    <div>
      <h3>Prescriptions</h3>
      
      {/* Tier 1 ONLY: Add Prescription Button */}
      <RequireTier minTier={1}>
        <Button onClick={handleAdd}>+ Add Prescription</Button>
      </RequireTier>

      {/* List rendered for everyone (Read-Only fallback) */}
      <DataGrid 
        data={data} 
        columns={[
          ...cols,
          {
            field: 'actions',
            renderCell: (row) => (
               // Tier 1 ONLY: Edit/Delete buttons. Others see nothing.
               <RequireTier minTier={1}>
                 <EditButton />
                 <DeleteButton />
               </RequireTier>
            )
          }
        ]} 
      />
    </div>
  );
};
```

> [!TIP]
> **Graceful Degradation:** For complex forms (e.g., a patient profile with both admin and clinical fields), render the entire form but pass a `disabled={!canEditClinical}` prop to specific inputs. This allows nurses/front-desk to read the form data clearly without the ability to modify locked fields.

## Verification Plan

### Automated Tests
- Write database tests using `pgTAP` or Jest to verify that a user with `role = 'nurse'` cannot `INSERT` into the `prescriptions` table via Supabase RLS.
- Write backend e2e tests to verify that a `POST /api/prescriptions` with a Nurse's JWT returns a `403 Forbidden`.

### Manual Verification
- Log into the frontend as **Front Desk**: Verify the "Add Vitals" and "Add Prescription" buttons are completely hidden, but data is visible.
- Log in as **Nurse**: Verify "Add Vitals" is available, but "Add Prescription" is hidden.
- Log in as **Doctor**: Verify all administrative, nursing, and clinical buttons are available and functional.
