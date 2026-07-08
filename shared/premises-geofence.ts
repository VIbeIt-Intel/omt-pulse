/** Default premises coverage radius shown on Live Monitor maps. */
export const PREMISE_COVERAGE_RADIUS_M = 2000;

export function haversineM(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const sl = Math.sin(dLat / 2);
  const sln = Math.sin(dLng / 2);
  const x =
    sl * sl +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      sln *
      sln;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

export function isWithinPremiseRadius(
  lat: number,
  lng: number,
  premiseLat: number,
  premiseLng: number,
  radiusM = PREMISE_COVERAGE_RADIUS_M,
): boolean {
  return haversineM({ lat, lng }, { lat: premiseLat, lng: premiseLng }) <= radiusM;
}

export function distanceFromPremiseM(
  lat: number,
  lng: number,
  premiseLat: number,
  premiseLng: number,
): number {
  return haversineM({ lat, lng }, { lat: premiseLat, lng: premiseLng });
}
