import { AsyncLocalStorage } from 'async_hooks';

export interface TenantState {
  user_id?: string;
  clinic_id?: string;
  role?: string;
  is_super_admin?: boolean;
  is_clinic_admin?: boolean;
}

export const tenantContext = new AsyncLocalStorage<TenantState>();

export class TenantContext {
  static getState(): TenantState | undefined {
    return tenantContext.getStore();
  }

  static getClinicId(): string | undefined {
    return this.getState()?.clinic_id;
  }

  static getUserId(): string | undefined {
    return this.getState()?.user_id;
  }

  static getRole(): string | undefined {
    return this.getState()?.role;
  }

  static isSuperAdmin(): boolean {
    return !!this.getState()?.is_super_admin;
  }
}
