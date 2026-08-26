import { SetMetadata } from '@nestjs/common';

/**
 * Decorator: @MinRoleTier(tier)
 *
 * Attaches a minimum tier requirement to an API endpoint.
 * Used with HierarchicalRolesGuard to enforce permission checks.
 *
 * Examples:
 *   @MinRoleTier(1) — Only Doctors (Tier 1) can access.
 *   @MinRoleTier(2) — Doctors AND Nurses can access.
 *   @MinRoleTier(3) — Everyone can access.
 */
export const MIN_ROLE_TIER_KEY = 'minRoleTier';
export const MinRoleTier = (tier: number) => SetMetadata(MIN_ROLE_TIER_KEY, tier);
