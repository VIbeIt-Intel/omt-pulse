import type { Express } from "express";

const CACHE_MS = 30 * 60 * 1000;

export type WeatherCondition = "clear" | "partly" | "cloudy" | "fog" | "rain" | "snow" | "thunder";
export type WeatherWarning = "thunder" | "heavyRain" | "rain" | "wind" | "fire" | null;

type WeatherBody = {
  tempC: number;
  condition: WeatherCondition;
  warning: WeatherWarning;
  place: string | null;
};

const cache = new Map<string, { at: number; body: WeatherBody }>();

function conditionOf(code: number): WeatherCondition {
  if (code >= 95) return "thunder";
  if (code === 45 || code === 48) return "fog";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return "rain";
  if (code === 0) return "clear";
  if (code === 1 || code === 2) return "partly";
  return "cloudy";
}

function isHeavyRain(code: number, mm: number): boolean {
  return code === 65 || code === 67 || code === 82 || mm >= 4;
}

function warningFor(input: {
  currentCode: number;
  currentWind: number;
  temp: number;
  humidity: number;
  currentRain: number;
  upcoming: Array<{ code: number; rain: number; wind: number }>;
}): WeatherWarning {
  const codes = [input.currentCode, ...input.upcoming.map((row) => row.code)];
  const rains = [input.currentRain, ...input.upcoming.map((row) => row.rain)];
  const winds = [input.currentWind, ...input.upcoming.map((row) => row.wind)];
  if (codes.some((code) => code >= 95)) return "thunder";
  if (codes.some((code, i) => isHeavyRain(code, rains[i] ?? 0))) return "heavyRain";
  if (codes.some((code) => conditionOf(code) === "rain")) return "rain";
  if (winds.some((wind) => wind >= 40)) return "wind";
  const dry = rains.every((mm) => mm < 0.2) && codes.every((code) => conditionOf(code) !== "rain" && conditionOf(code) !== "thunder");
  if (dry && input.temp >= 30 && input.humidity <= 30 && input.currentWind >= 20) return "fire";
  return null;
}

/** Nearest suburb or town for these coordinates. Weather still shows if this fails. */
async function placeName(lat: number, lng: number): Promise<string | null> {
  try {
    const url = new URL("https://nominatim.openstreetmap.org/reverse");
    url.searchParams.set("lat", lat.toFixed(4));
    url.searchParams.set("lon", lng.toFixed(4));
    url.searchParams.set("format", "json");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("zoom", "14");
    url.searchParams.set("accept-language", "af");
    const upstream = await fetch(url, {
      headers: {
        "User-Agent": "OMT-Pulse/weather (https://omtpulse.com)",
        Accept: "application/json",
      },
    });
    if (!upstream.ok) return null;
    const data = await upstream.json() as {
      address?: {
        suburb?: string;
        neighbourhood?: string;
        village?: string;
        town?: string;
        city?: string;
        municipality?: string;
      };
    };
    const address = data.address;
    const name = [
      address?.suburb,
      address?.neighbourhood,
      address?.village,
      address?.town,
      address?.city,
      address?.municipality,
    ].map((part) => part?.trim()).find((part) => !!part);
    return name || null;
  } catch {
    return null;
  }
}

export function registerWeatherRoutes(app: Express): void {
  app.get("/api/weather", async (req, res) => {
    if (!req.currentUser) return res.status(401).json({ message: "Unauthorized" });
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return res.status(400).json({ message: "lat and lng required" });
    }
    const key = `${lat.toFixed(2)},${lng.toFixed(2)}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return res.json(hit.body);

    try {
      const url = new URL("https://api.open-meteo.com/v1/forecast");
      url.searchParams.set("latitude", lat.toFixed(4));
      url.searchParams.set("longitude", lng.toFixed(4));
      url.searchParams.set("current", "temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,precipitation");
      url.searchParams.set("hourly", "weather_code,precipitation,wind_speed_10m");
      url.searchParams.set("forecast_days", "1");
      url.searchParams.set("timezone", "auto");
      url.searchParams.set("wind_speed_unit", "kmh");
      const upstream = await fetch(url, { headers: { "User-Agent": "OMT-Pulse/weather" } });
      if (!upstream.ok) return res.status(502).json({ message: "Weather unavailable" });
      const data = await upstream.json() as {
        current?: {
          temperature_2m?: number;
          relative_humidity_2m?: number;
          weather_code?: number;
          wind_speed_10m?: number;
          precipitation?: number;
          time?: string;
        };
        hourly?: {
          time?: string[];
          weather_code?: number[];
          precipitation?: number[];
          wind_speed_10m?: number[];
        };
      };
      const current = data.current;
      if (!current || typeof current.temperature_2m !== "number" || typeof current.weather_code !== "number") {
        return res.status(502).json({ message: "Weather unavailable" });
      }
      const times = data.hourly?.time ?? [];
      const start = current.time ? times.findIndex((time) => time >= current.time!) : 0;
      const from = start < 0 ? 0 : start;
      const upcoming = [];
      for (let i = from; i < Math.min(times.length, from + 6); i++) {
        upcoming.push({
          code: data.hourly?.weather_code?.[i] ?? 0,
          rain: data.hourly?.precipitation?.[i] ?? 0,
          wind: data.hourly?.wind_speed_10m?.[i] ?? 0,
        });
      }
      const body: WeatherBody = {
        tempC: Math.round(current.temperature_2m),
        condition: conditionOf(current.weather_code),
        warning: warningFor({
          currentCode: current.weather_code,
          currentWind: current.wind_speed_10m ?? 0,
          temp: current.temperature_2m,
          humidity: current.relative_humidity_2m ?? 100,
          currentRain: current.precipitation ?? 0,
          upcoming,
        }),
        place: await placeName(lat, lng),
      };
      cache.set(key, { at: Date.now(), body });
      res.json(body);
    } catch {
      res.status(502).json({ message: "Weather unavailable" });
    }
  });
}
