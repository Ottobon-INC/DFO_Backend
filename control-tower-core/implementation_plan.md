# Hierarchical Role-Based Access Control (RBAC) Implementation Plan

## Goal Description
Implement a strict, hierarchical Role-Based Access Control (RBAC) system for a medical application's clinic-facing operations. The system will enforce a cascading permission model where higher-tier roles inherit permissions from lower-tier roles, while strictly preventing lower-tier roles from modifying higher-tier data. 

**Note on Super Admin:** The `Super Admin` role exists outside this hierarchy on the application/system end and does not interfere with the hospital-side RBAC.

**The Hospital-Side Hierarchy:**
- **Tier 1 (Doctor):** Full CRUD across all domains. Inherits Tier 2 & 3.
- **Tier 2 (Nurse):** Edit clinical nursing data (vitals). Read-only for Doctor data. Inherits Tier 3.
- **Tier 3 (Front Desk):** Edit administrative data (appointments). Read-only for all clinical data.

## Proposed Architecture

### 1. The "Code-Only" Tier Translation Strategy

Since we share a database with other developers, **we will NOT touch the database schema or enable RLS.** Doing so would break the app for the rest of the team.

Instead, we will keep the existing string-based roles in the database (e.g., `'doctor'`, `'nurse'`), but we will translate them into mathematical Tiers **in memory** inside our Backend and Frontend code.

**The Mapping Dictionary:**
```typescript
const RoleTierMap: Record<string, number> = {
  'doctor': 1,
  'nurse': 2,
  'cro': 3,
  'front_desk': 3,
  'admin': 1 // Admins get top-tier fallback access
};
```
Whenever a user logs in, the code will look at their string title, check this dictionary, and assign them a temporary Tier number just for that session. This gives us all the benefits of math-based security without touching the database!

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
