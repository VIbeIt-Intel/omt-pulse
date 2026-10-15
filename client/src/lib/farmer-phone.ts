/**
 * This test install shows the four farmer tiles for a normal Reporter.
 * Security sites are unchanged unless the app is built with VITE_FARMER_PHONE=1.
 */
export function usesFarmerPhone(role: string): boolean {
  return role === "reporter" && import.meta.env.VITE_FARMER_PHONE === "1";
}
