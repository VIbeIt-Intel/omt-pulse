export type AuthUser = {
  id: string;
  organizationId: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  subscriptionStatus: string;
  trialEndsAt?: string | null;
  subscriptionCurrentPeriodEnd?: string | null;
  mustChangePassword?: boolean;
  avatarUrl?: string | null;
  orgName?: string | null;
  isSuperadmin?: boolean;
  workstationId?: number | null;
  workstation?: {
    id: number;
    name: string;
    type: string;
    locationId: number | null;
    locationName: string | null;
    kioskMode: boolean;
  } | null;
};
