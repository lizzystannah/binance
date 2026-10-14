/**
 * Candle wick classification relative to trade direction.
 *
 * For each trade, the last closed candle before entry is classified based on
 * its wick structure (pavio = wick) to determine whether the candle's
 * rejection/confirmation aligns with the trade direction or goes against it.
 *
 * Strength tiers: normal → "forte" → "muito forte" based on the dominant
 * wick's share of the total candle range.
 *
 * Doji candles (body < 10% of total range) get a separate "doji" prefix.
 */

export type WickClass = {
  label: string;
  type: "pavio" | "doji";
  direction: "call" | "put" | "contra";
  strength: "" | "forte" | "muito forte";
};

const DOJI_BODY_RATIO = 0.1; // body must be <10% of range to be doji
const STRONG_RATIO = 0.3; // dominant wick >30% of range → "forte"
const VERY_STRONG_RATIO = 0.5; // dominant wick >50% of range → "muito forte"

/**
 * Classify a single candle's wick relative to a trade direction.
 * Returns a human-readable Portuguese label.
 */
export function classifyCandleWick(
  candle: { o: number; h: number; l: number; c: number } | null | undefined,
  tradeType: "CALL" | "PUT" | "BUY" | "SELL" | undefined,
): string {
  if (!candle || !tradeType) return "N/A";

  const { o, h, l, c } = candle;
  const body = Math.abs(c - o);
  const upperWick = h - Math.max(o, c);
  const lowerWick = Math.min(o, c) - l;
  const totalRange = h - l;

  if (totalRange === 0) return "N/A";

  const bodyRatio = body / totalRange;
  const isDoji = bodyRatio < DOJI_BODY_RATIO;

  const isBuy = tradeType === "CALL" || tradeType === "BUY";

  // wickDiff > 0 = lower wick bigger (buying pressure / support rejection)
  // wickDiff < 0 = upper wick bigger (selling pressure / resistance rejection)
  const wickDiff = lowerWick - upperWick;

  // For CALL/BUY:  lower > upper → directional (call), upper > lower → contra
  // For PUT/SELL: upper > lower → directional (put),  lower > upper → contra
  let direction: "call" | "put" | "contra";
  if (wickDiff > 0) {
    // Lower wick is bigger → buying pressure
    direction = isBuy ? "call" : "contra";
  } else if (wickDiff < 0) {
    // Upper wick is bigger → selling pressure
    direction = isBuy ? "contra" : "put";
  } else {
    // Equal wicks → tiebreak in favour of trade direction
    direction = isBuy ? "call" : "put";
  }

  // Strength based on dominant wick ratio
  const dominantWick = Math.max(upperWick, lowerWick);
  const wickRatio = dominantWick / totalRange;

  let strength: "" | "forte" | "muito forte" = "";
  if (wickRatio > VERY_STRONG_RATIO) strength = "muito forte";
  else if (wickRatio > STRONG_RATIO) strength = "forte";

  const prefix = isDoji ? "doji" : "pavio";

  if (strength) {
    return `${prefix} ${strength} ${direction}`;
  }
  return `${prefix} ${direction}`;
}

/**
 * Extract entry candle from a trade's snapshot and classify it.
 * Safe wrapper — returns "N/A" if snapshot or entryCandle is missing.
 */
export function classifyTradeWick(trade: {
  type?: "CALL" | "PUT" | "BUY" | "SELL";
  snapshot?: Record<string, unknown> | null;
}): string {
  const entryCandle = trade.snapshot?.entryCandle as
    | { o: number; h: number; l: number; c: number }
    | undefined
    | null;
  return classifyCandleWick(entryCandle ?? null, trade.type);
}

/** All possible wick classification labels (for ordered stat display). */
export const WICK_CLASSIFICATIONS: string[] = [
  "pavio call",
  "pavio forte call",
  "pavio muito forte call",
  "pavio put",
  "pavio forte put",
  "pavio muito forte put",
  "pavio contra",
  "pavio forte contra",
  "pavio muito forte contra",
  "doji call",
  "doji forte call",
  "doji muito forte call",
  "doji put",
  "doji forte put",
  "doji muito forte put",
  "doji contra",
  "doji forte contra",
  "doji muito forte contra",
];

export const LAST_5_WICKS_BANDS = [
  "Forte Venda (Pavis Superiores Longos)",
  "Venda (Rejeição Superior Dominante)",
  "Forte Compra (Pavis Inferiores Longos)",
  "Compra (Rejeição Inferior Dominante)",
  "Neutro / Indefinido",
];

export interface CandleSimple {
  o: number;
  h: number;
  l: number;
  c: number;
}

/**
 * Analisa as últimas 5 velas para detectar se há dominância e pressão de pavios
 * superiores (rejeição de alta / zona vendedora) ou pavis inferiores (rejeição de baixa / zona compradora).
 * Identifica também formações de martelo (hammer), estrela cadente (shooting star) e intensidade das sombras.
 */
export function analyzeLast5Wicks(candles: CandleSimple[] | null | undefined): string {
  if (!candles || candles.length === 0) return "N/A";
  const windowed = candles.slice(-5);
  if (windowed.length < 2) return "Neutro / Indefinido";

  let sumUpperWick = 0;
  let sumLowerWick = 0;
  let sumBody = 0;
  let sumRange = 0;
  let redCount = 0;
  let greenCount = 0;
  let strongUpperCount = 0;
  let strongLowerCount = 0;
  let shootingStarOrPinbarBearCount = 0;
  let hammerOrPinbarBullCount = 0;

  for (const c of windowed) {
    const range = Math.max(0.00001, c.h - c.l);
    const body = Math.abs(c.c - c.o);
    const upperWick = c.h - Math.max(c.o, c.c);
    const lowerWick = Math.min(c.o, c.c) - c.l;

    sumUpperWick += upperWick;
    sumLowerWick += lowerWick;
    sumBody += body;
    sumRange += range;

    if (c.c > c.o) greenCount++;
    else if (c.c < c.o) redCount++;

    const upperRatio = upperWick / range;
    const lowerRatio = lowerWick / range;

    // Pavio muito longo individual (>= 40% da amplitude total da vela)
    if (upperRatio >= 0.40) strongUpperCount++;
    if (lowerRatio >= 0.40) strongLowerCount++;

    // Estrela cadente / Pinbar de Venda: pavio superior >= 50% e corpo no terço inferior
    if (upperRatio >= 0.50 && lowerWick / range <= 0.20) {
      shootingStarOrPinbarBearCount++;
    }

    // Martelo / Pinbar de Compra: pavio inferior >= 50% e corpo no terço superior
    if (lowerRatio >= 0.50 && upperWick / range <= 0.20) {
      hammerOrPinbarBullCount++;
    }
  }

  const totalWick = sumUpperWick + sumLowerWick;
  if (totalWick === 0 || sumRange === 0) return "Neutro / Indefinido";

  const upperDominance = sumUpperWick / totalWick; // 0 to 1
  const lowerDominance = sumLowerWick / totalWick; // 0 to 1

  // Critérios para VENDA (Pavis Superiores dominando)
  const isBearishDominance = upperDominance >= 0.58;
  const isBullishDominance = lowerDominance >= 0.58;

  // FORTE VENDA:
  // - Mais de uma vela com pavio superior longo (>= 2) OU presença de Shooting Star / Pinbar de Venda
  // - OU dominância esmagadora de pavis superiores (>= 68%) e predomínio de velas de venda/baixa
  if (
    (strongUpperCount >= 2 && upperDominance >= 0.55) ||
    (shootingStarOrPinbarBearCount >= 1 && upperDominance >= 0.58) ||
    (upperDominance >= 0.68 && (redCount >= greenCount || strongUpperCount >= 1))
  ) {
    return "Forte Venda (Pavis Superiores Longos)";
  }

  // FORTE COMPRA:
  // - Mais de uma vela com pavio inferior longo (>= 2) OU presença de Martelo / Pinbar de Compra
  // - OU dominância esmagadora de pavis inferiores (>= 68%) e predomínio de velas de compra/alta
  if (
    (strongLowerCount >= 2 && lowerDominance >= 0.55) ||
    (hammerOrPinbarBullCount >= 1 && lowerDominance >= 0.58) ||
    (lowerDominance >= 0.68 && (greenCount >= redCount || strongLowerCount >= 1))
  ) {
    return "Forte Compra (Pavis Inferiores Longos)";
  }

  // VENDA MODERADA
  if (isBearishDominance || (redCount > greenCount && upperDominance > 0.52)) {
    return "Venda (Rejeição Superior Dominante)";
  }

  // COMPRA MODERADA
  if (isBullishDominance || (greenCount > redCount && lowerDominance > 0.52)) {
    return "Compra (Rejeição Inferior Dominante)";
  }

  return "Neutro / Indefinido";
}

/**
 * Classifica os pavis das últimas 5 velas a partir do snapshot do trade.
 */
export function classifyTradeLast5Wicks(trade: {
  snapshot?: Record<string, unknown> | null;
}): string {
  const sh = trade.snapshot as Record<string, any> | undefined | null;
  if (!sh) return "N/A";
  if (sh._last5Wicks) return String(sh._last5Wicks);
  if (sh.last5Wicks) return String(sh.last5Wicks);
  if (Array.isArray(sh.last5Candles)) {
    return analyzeLast5Wicks(sh.last5Candles);
  }
  return "N/A";
}

