/**
 * Strategy filters — lógica genérica de filtros.
 *
 * Contém apenas os tipos e funções agnósticos de corretora (usados pelo código
 * ativo, p.ex. `src/lib/store.ts`).
 */

/**
 * Ações Binance: BUY/SELL (spot), LONG/SHORT (futuros). CALL/PUT mantidos por
 * compatibilidade legada: CALL ≡ BUY/LONG, PUT ≡ SELL/SHORT.
 */
export type StrategyAction = "CALL" | "PUT" | "BUY" | "SELL" | "LONG" | "SHORT" | "EXIT" | "FLAT" | null;

export interface StrategyFilterRange {
  id: string;
  min: number;
  max: number;
  action: "allow" | "ignore" | "invert";
  direction?: "all" | "buy" | "sell";
}

export interface AssetConfig {
  asset: string;
  direction: "all" | "buy" | "sell";
  action: "allow" | "ignore";
}

export type OptionAction = "allow" | "ignore" | "invert" | "invertBuy" | "invertSell";

export interface OptionConfig {
  option: string;
  action: OptionAction;
  direction?: "all" | "buy" | "sell";
}

export interface StrategyFilterValue {
  enabled: boolean;
  marketType?: string; // Tipo de mercado (agnóstico — sem acoplamento a sintéticos/forex)
  ranges?: StrategyFilterRange[]; // Para filtros do tipo "range"
  value?: string;                // Para filtros do tipo "select"
  values?: string[];             // Para filtros do tipo "multiselect"
  action?: "allow" | "ignore" | "invert"; // Ação global do filtro (para select/multiselect)
  direction?: "all" | "buy" | "sell";    // Filtro específico para comprar/vender ou ambos
  assetConfigs?: AssetConfig[];   // Configurações individuais por ativo
  optionConfigs?: OptionConfig[]; // Configurações individuais por opção (select/multiselect)
}

export function matchesDirection(action: StrategyAction, permitted: "all" | "buy" | "sell" | undefined): boolean {
  if (!action) return false;
  if (!permitted || permitted === "all") return true;
  const isBuy = action === "CALL" || action === "BUY" || action === "LONG";
  const isSell = action === "PUT" || action === "SELL" || action === "SHORT";
  if (permitted === "buy" && isBuy) return true;
  if (permitted === "sell" && isSell) return true;
  return false;
}

/**
 * Deeply merges two sets of strategy filters (e.g. existing robot filters + newly configured stats filters).
 * Instead of overwriting entire filter objects (like _asset or _rsi), it merges their internal option configs,
 * ranges, values, preserving all previously ignored or configured items.
 */
export function mergeStrategyFilters(
  baseFilters?: Record<string, StrategyFilterValue> | null,
  incomingFilters?: Record<string, StrategyFilterValue> | null
): Record<string, StrategyFilterValue> {
  const result: Record<string, StrategyFilterValue> = {};

  // 1. Copy all base filters deeply
  if (baseFilters) {
    for (const [key, filter] of Object.entries(baseFilters)) {
      if (filter) {
        result[key] = JSON.parse(JSON.stringify(filter));
      }
    }
  }

  // 2. If no incoming filters, return base copy
  if (!incomingFilters) {
    return result;
  }

  // 3. Merge each incoming filter key into result
  for (const [key, incFilter] of Object.entries(incomingFilters)) {
    if (!incFilter) continue;

    const baseFilter = result[key];
    if (!baseFilter) {
      // New filter key entirely
      result[key] = JSON.parse(JSON.stringify(incFilter));
      continue;
    }

    // Both base and incoming exist for this filter key -> perform deep internal merge
    const merged: StrategyFilterValue = {
      enabled: incFilter.enabled ?? baseFilter.enabled ?? true,
      action: incFilter.action || baseFilter.action || "allow",
      direction: (incFilter.direction && incFilter.direction !== "all") ? incFilter.direction : (baseFilter.direction || "all"),
    };

    // --- Merge Option Configs (for select, multiselect, _asset, etc.) ---
    const baseOptConfigs: OptionConfig[] = baseFilter.optionConfigs || (baseFilter.assetConfigs?.map(ac => ({
      option: ac.asset,
      action: ac.action as OptionAction,
      direction: ac.direction,
    }))) || [];

    const incOptConfigs: OptionConfig[] = incFilter.optionConfigs || (incFilter.assetConfigs?.map(ac => ({
      option: ac.asset,
      action: ac.action as OptionAction,
      direction: ac.direction,
    }))) || [];

    if (baseOptConfigs.length > 0 || incOptConfigs.length > 0) {
      const optMap = new Map<string, OptionConfig>();

      // Base options first
      baseOptConfigs.forEach(oc => {
        optMap.set(oc.option, { ...oc });
      });

      // Overlay incoming options
      incOptConfigs.forEach(incOc => {
        const existing = optMap.get(incOc.option);
        if (existing) {
          optMap.set(incOc.option, {
            ...existing,
            action: incOc.action,
            direction: incOc.direction ?? existing.direction ?? "all",
          });
        } else {
          optMap.set(incOc.option, { ...incOc });
        }
      });

      const mergedOptConfigs = Array.from(optMap.values());
      merged.optionConfigs = mergedOptConfigs;

      // Update values array (all options not explicitly ignored)
      const ignoredOptions = new Set(mergedOptConfigs.filter(c => c.action === "ignore").map(c => c.option));
      const baseValues = baseFilter.values || (baseFilter.value ? [baseFilter.value] : []);
      const incValues = incFilter.values || (incFilter.value ? [incFilter.value] : []);

      const combinedValuesSet = new Set<string>();
      baseValues.forEach(v => {
        if (!ignoredOptions.has(v)) combinedValuesSet.add(v);
      });
      incValues.forEach(v => {
        if (!ignoredOptions.has(v)) combinedValuesSet.add(v);
      });
      mergedOptConfigs.filter(c => c.action === "allow" || c.action === "invert" || c.action === "invertBuy" || c.action === "invertSell").forEach(c => {
        combinedValuesSet.add(c.option);
      });

      merged.values = Array.from(combinedValuesSet);
    } else if (incFilter.value !== undefined || baseFilter.value !== undefined) {
      merged.value = incFilter.value !== undefined ? incFilter.value : baseFilter.value;
      if (incFilter.values || baseFilter.values) {
        merged.values = incFilter.values || baseFilter.values;
      }
    } else if (incFilter.values || baseFilter.values) {
      merged.values = Array.from(new Set([...(baseFilter.values || []), ...(incFilter.values || [])]));
    }

    // --- Merge Ranges (for RSI, ADX, custom stats) ---
    const baseRanges = baseFilter.ranges || [];
    const incRanges = incFilter.ranges || [];

    if (baseRanges.length > 0 || incRanges.length > 0) {
      const mergedRanges: StrategyFilterRange[] = [];
      const usedIncRangeIds = new Set<string>();

      // Base ranges first: if incoming covers the exact same bounds, update it; otherwise preserve base range
      baseRanges.forEach(br => {
        const matchingInc = incRanges.find(ir => ir.min === br.min && ir.max === br.max);
        if (matchingInc) {
          mergedRanges.push({
            id: br.id || matchingInc.id || crypto.randomUUID(),
            min: matchingInc.min,
            max: matchingInc.max,
            action: matchingInc.action,
            direction: matchingInc.direction || br.direction || "all",
          });
          usedIncRangeIds.add(matchingInc.id);
        } else {
          mergedRanges.push({ ...br });
        }
      });

      // Add any incoming ranges that were not in base
      incRanges.forEach(ir => {
        if (!usedIncRangeIds.has(ir.id) && !mergedRanges.some(r => r.min === ir.min && r.max === ir.max)) {
          mergedRanges.push({ ...ir });
        }
      });

      merged.ranges = mergedRanges;
    }

    result[key] = merged;
  }

  return result;
}
