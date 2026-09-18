/**
 * Role Tier Mapping — The Core of the Hierarchical RBAC System.
 *
 * This dictionary translates string-based role names (stored in the database)
 * into mathematical tier numbers for fast, inheritance-based permission checks.
 *
 * Rule: A user with tier N automatically inherits all permissions of tiers > N.
 *   - Tier 1 (Doctor): God-mode. Can do everything.
 *   - Tier 2 (Nurse): Can edit nursing data + admin data. Cannot touch doctor-only data.
 *   - Tier 3 (Front Desk / CRO): Can edit admin data only. Read-only for clinical data.
 *
 * To add a new role, simply add a new entry here with the appropriate tier number.
 * Example: 'physician_assistant': 1  — gives them Doctor-level access instantly.
 */
export const RoleTierMap: Record<string, number> = {
    'doctor': 1,
    'dr': 1,
    'physician': 1,
    'consultant': 1,
    'admin': 1,
    'super_admin': 1,
    'superadmin': 1,
    'hospital_admin': 1,
    'clinic_admin': 1,
    'nurse': 2,
    'staff_nurse': 2,
    'staff nurse': 2,
    'triage_nurse': 2,
    'triage nurse': 2,
    'lab_staff': 2,
    'lab staff': 2,
    'ivf nurse': 2,
    'ivf_nurse': 2,
    'cro': 3,
    'front_desk': 3,
    'front desk': 3,
    'frontdesk': 3,
    'receptionist': 3,
    'front desk staff': 3,
    'staff': 3,
};

/** The default tier for any unrecognized role (most restrictive). */
export const DEFAULT_ROLE_TIER = 3;

/**
 * Resolves a string role name to its numerical tier.
 * Returns DEFAULT_ROLE_TIER if the role is not found in the map.
 */
export function getRoleTier(role: string | undefined | null): number {
    if (!role) return DEFAULT_ROLE_TIER;
    return RoleTierMap[role.toLowerCase()] ?? DEFAULT_ROLE_TIER;
}
