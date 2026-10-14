import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function parseDuration(val: any): number {
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    if (val.includes('/')) {
      const [num, den] = val.split('/');
      const parsed = Number(num) / Number(den);
      return isNaN(parsed) ? 1 : parsed;
    }
    const parsed = parseFloat(val);
    if (!isNaN(parsed)) return parsed;
  }
  return 1;
}

/**
 * Returns the formatted trading day (YYYY-MM-DD) for a given timestamp, Date, or string.
 * Ensures 100% synchronization between robot daily stop, management daily stop, and UI displays by using UTC.
 */
export function getTradingDay(ts?: number | Date | string): string {
  if (!ts) {
    const d = new Date();
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  }
  if (typeof ts === "string") {
    if (/^\d{4}-\d{2}-\d{2}/.test(ts)) {
      return ts.substring(0, 10);
    }
  }
  let val = ts;
  if (typeof ts === "number") {
    if (ts < 10000000000) {
      val = ts * 1000;
    }
  }
  const d = new Date(val);
  if (isNaN(d.getTime())) {
    const now = new Date();
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}`;
  }
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function mergeSingleTrade(existing: any, incoming: any): any {
  if (!existing) return incoming;
  if (!incoming) return existing;

  const merged = { ...existing };
  for (const [key, val] of Object.entries(incoming)) {
    if (val !== undefined && val !== null) {
      merged[key] = val;
    }
  }
  // If existing result is completed ("WIN" or "LOSS"), do not revert to "OPEN"
  if ((existing.result === "WIN" || existing.result === "LOSS") && incoming.result === "OPEN") {
    merged.result = existing.result;
    merged.pnl = existing.pnl ?? merged.pnl;
  }
  return merged;
}

export function mergeTradeArrays(existingTrades: any[] = [], incomingTrades: any[] = []): any[] {
  const map = new Map<string, any>();
  existingTrades.forEach(t => {
    if (t?.id) map.set(String(t.id), t);
  });
  incomingTrades.forEach(t => {
    if (t?.id) {
      const idStr = String(t.id);
      const prev = map.get(idStr);
      map.set(idStr, mergeSingleTrade(prev, t));
    }
  });
  return Array.from(map.values()).sort((a: any, b: any) => (b.ts || 0) - (a.ts || 0));
}

