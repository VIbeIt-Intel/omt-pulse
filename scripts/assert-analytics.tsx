/**
 * Analytics helpers / filter semantics assertions.
 * Run: npx tsx scripts/assert-analytics.tsx
 */
import {
  chartOpacity,
  intensityFill,
} from "../client/src/components/analytics/analytics-chart-theme.ts";

let passed = 0;
let failed = 0;

function assert(cond: boolean, message: string) {
  if (cond) {
    passed += 1;
    console.log(`  PASS  ${message}`);
  } else {
    failed += 1;
    console.error(`  FAIL  ${message}`);
  }
}

type DateGrouping = "daily" | "weekly" | "monthly" | "yearly";

function getISOWeek(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

function getDateBucketKey(dateStr: string, grouping: DateGrouping): string {
  const d = new Date(dateStr + "T00:00:00");
  if (grouping === "daily") return dateStr;
  if (grouping === "weekly") {
    const wk = getISOWeek(d);
    return `${d.getFullYear()}-W${String(wk).padStart(2, "0")}`;
  }
  if (grouping === "monthly") {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }
  return String(d.getFullYear());
}

function bucketKeyToLabel(key: string, grouping: DateGrouping): string {
  if (grouping === "daily") return key.slice(5);
  if (grouping === "weekly") {
    const [yr, wPart] = key.split("-W");
    return `W${wPart} ${yr}`;
  }
  if (grouping === "monthly") {
    const d = new Date(key + "-01T00:00:00");
    return d.toLocaleString("default", { month: "short", year: "numeric" });
  }
  return key;
}

/** Mirrors Other-note + category filter matching from analytics.tsx */
function matchesTypeFilter(
  incident: { categoryId: number | null; otherCategoryNote?: string | null },
  filter: { categoryId: number | null; otherCategoryNote: string | null },
): boolean {
  if (filter.categoryId === null) return true;
  if (incident.categoryId !== filter.categoryId) return false;
  if (filter.otherCategoryNote !== null) {
    const note = incident.otherCategoryNote?.trim() || "";
    if (note !== filter.otherCategoryNote) return false;
  }
  return true;
}

/** Mirrors type-chart bucket assignment (panic exclusive of category). */
function typeBucketCounts(
  rows: Array<{ categoryId: number; otherCategoryNote?: string | null; panicClosedAt?: string | null; isOther?: boolean }>,
): { categoryTotal: number; panicTotal: number; sumBars: number } {
  let categoryTotal = 0;
  let panicTotal = 0;
  for (const r of rows) {
    if (r.panicClosedAt != null) {
      panicTotal += 1;
      continue;
    }
    categoryTotal += 1;
  }
  return { categoryTotal, panicTotal, sumBars: categoryTotal + panicTotal };
}

console.log("\n1) Chart theme intensity / opacity");
{
  assert(intensityFill(0, 10).includes("hsl(155"), "zero value uses green intensity scale");
  assert(intensityFill(10, 10) !== intensityFill(1, 10), "higher count differs from lower count");
  assert(chartOpacity(true, true) === 1, "selected bar full opacity");
  assert(chartOpacity(false, true) < 1, "unselected bar dims when any selected");
  assert(chartOpacity(false, false) === 1, "no selection → full opacity");
}

console.log("\n2) Date bucket keys / labels");
{
  assert(getDateBucketKey("2026-07-22", "daily") === "2026-07-22", "daily key");
  assert(bucketKeyToLabel("2026-07-22", "daily") === "07-22", "daily label");
  assert(getDateBucketKey("2026-07-22", "monthly") === "2026-07", "monthly key");
  assert(getDateBucketKey("2026-07-22", "yearly") === "2026", "yearly key");
  const week = getDateBucketKey("2026-07-22", "weekly");
  assert(/^2026-W\d{2}$/.test(week), `weekly key shape (${week})`);
}

console.log("\n3) Other-note type filter does not collapse notes");
{
  const filter = { categoryId: 9, otherCategoryNote: "Fence" };
  assert(matchesTypeFilter({ categoryId: 9, otherCategoryNote: "Fence" }, filter), "exact Other note matches");
  assert(!matchesTypeFilter({ categoryId: 9, otherCategoryNote: "Gate" }, filter), "different Other note excluded");
  assert(!matchesTypeFilter({ categoryId: 9, otherCategoryNote: "" }, filter), "bare Other excluded when note filter set");
  assert(matchesTypeFilter({ categoryId: 3 }, { categoryId: 3, otherCategoryNote: null }), "plain category still matches");
}

console.log("\n4) Panic origin does not double-count vs category bars");
{
  const rows = [
    { categoryId: 1, panicClosedAt: null },
    { categoryId: 2, panicClosedAt: "2026-07-01T00:00:00Z" },
    { categoryId: 2, panicClosedAt: "2026-07-02T00:00:00Z" },
  ];
  const { categoryTotal, panicTotal, sumBars } = typeBucketCounts(rows);
  assert(categoryTotal === 1, `category bars count 1, got ${categoryTotal}`);
  assert(panicTotal === 2, `panic bars count 2, got ${panicTotal}`);
  assert(sumBars === rows.length, "sum of bars equals incident count (no double-count)");
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
