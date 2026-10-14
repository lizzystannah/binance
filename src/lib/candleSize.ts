export interface CandleSimple {
  o: number;
  h: number;
  l: number;
  c: number;
  t?: number;
}

export const CANDLE_BODY_SIZE_BANDS = [
  "Grande (>= 1.35x Média de Corpos)",
  "Médio (0.60x - 1.35x Média de Corpos)",
  "Pequeno (<= 0.60x Média de Corpos)",
];

/**
 * Classifica dinamicamente o tamanho do corpo da vela em relação à média móvel
 * dos corpos das últimas 20 velas (excluindo sombras).
 * - Grande: corpo >= 1.35x média
 * - Pequeno: corpo <= 0.60x média
 * - Médio: 0.60x a 1.35x média
 */
export function classifyCandleBodySize(
  candles: CandleSimple[] | null | undefined,
  index?: number
): string {
  if (!candles || candles.length === 0) return "Médio (0.60x - 1.35x Média de Corpos)";
  const i = index !== undefined ? index : candles.length - 1;
  if (i < 0 || i >= candles.length) return "Médio (0.60x - 1.35x Média de Corpos)";

  const targetCandle = candles[i];
  const targetBody = Math.abs(targetCandle.c - targetCandle.o);

  const start = Math.max(0, i - 20);
  const sampleCount = i - start;

  if (sampleCount < 2) {
    return "Médio (0.60x - 1.35x Média de Corpos)";
  }

  let sumBodies = 0;
  for (let k = start; k < i; k++) {
    sumBodies += Math.abs(candles[k].c - candles[k].o);
  }
  const avgBody = (sumBodies / sampleCount) || 0.00001;

  if (targetBody >= avgBody * 1.35) {
    return "Grande (>= 1.35x Média de Corpos)";
  }
  if (targetBody <= avgBody * 0.60) {
    return "Pequeno (<= 0.60x Média de Corpos)";
  }
  return "Médio (0.60x - 1.35x Média de Corpos)";
}

export const EXTENDED_CANDLE_PATTERNS = [
  "Marubozu de Alta",
  "Marubozu de Baixa",
  "Braçada de Alta (Ignição)",
  "Braçada de Baixa (Ignição)",
  "Martelo Invertido",
  "Martelo (Hammer)",
  "Estrela Cadente (Shooting Star)",
  "Momentum de Alta",
  "Momentum de Baixa",
  "BullishEngulfing",
  "BearishEngulfing",
  "BullishHarami",
  "BearishHarami",
  "Doji",
  "Sem Padrão",
];

/**
 * Detecta padrões de velas com regras de alta precisão baseadas em:
 * 1. Marubozu (Alta / Baixa): corpo >= 88% do range total e sombras <= 6%
 * 2. Braçada de Alta / Baixa (Ignição): corpo grande rompendo consolidação prévia
 * 3. Martelo Invertido: sombra superior >= 2x corpo, sombra inferior <= 12%
 * 4. Martelo (Hammer): sombra inferior >= 2x corpo, sombra superior <= 12%
 * 5. Estrela Cadente (Shooting Star): sombra superior >= 2x corpo no topo
 * 6. Momentum (Alta / Baixa): rompimento com corpo dominante >= 70%
 * 7. Engolfos & Haramis
 * 8. Doji
 */
export function detectCandlePattern(
  candles: CandleSimple[] | null | undefined,
  index?: number
): string {
  if (!candles || candles.length === 0) return "Sem Padrão";
  const i = index !== undefined ? index : candles.length - 1;
  if (i < 1 || i >= candles.length) return "Sem Padrão";

  const c = candles[i];
  const p1 = candles[i - 1];

  const body = Math.abs(c.c - c.o);
  const range = Math.max(0.00001, c.h - c.l);
  const isBullish = c.c > c.o;
  const isBearish = c.c < c.o;

  const upperShadow = c.h - Math.max(c.o, c.c);
  const lowerShadow = Math.min(c.o, c.c) - c.l;

  const bodyRatio = body / range;
  const upperRatio = upperShadow / range;
  const lowerRatio = lowerShadow / range;

  // Média móvel dos corpos das 20 velas anteriores
  const start = Math.max(0, i - 20);
  const sampleCount = i - start;
  let sumBodies = 0;
  for (let k = start; k < i; k++) {
    sumBodies += Math.abs(candles[k].c - candles[k].o);
  }
  const avgBody = (sampleCount > 0 ? sumBodies / sampleCount : body) || 0.00001;
  const isBodyLarge = body >= avgBody * 1.35;

  // 1. MARUBOZU (Corpo dominante >= 88% com sombras minúsculas <= 6%)
  if (bodyRatio >= 0.88 && upperRatio <= 0.06 && lowerRatio <= 0.06) {
    return isBullish ? "Marubozu de Alta" : "Marubozu de Baixa";
  }

  // 2. BRAÇADA / IGNIÇÃO (Rompimento forte de consolidação de 5 velas)
  if (i >= 5 && isBodyLarge && bodyRatio >= 0.75) {
    let maxPrev5 = -Infinity;
    let minPrev5 = Infinity;
    for (let k = i - 5; k < i; k++) {
      if (candles[k].h > maxPrev5) maxPrev5 = candles[k].h;
      if (candles[k].l < minPrev5) minPrev5 = candles[k].l;
    }

    if (isBullish && upperRatio <= 0.15 && c.c > maxPrev5) {
      return "Braçada de Alta (Ignição)";
    }
    if (isBearish && lowerRatio <= 0.15 && c.c < minPrev5) {
      return "Braçada de Baixa (Ignição)";
    }
  }

  // 3. MARTELO INVERTIDO (Sombra superior longa >= 2x corpo, sombra inferior mínima <= 12%)
  if (
    upperShadow >= body * 2.0 &&
    lowerRatio <= 0.12 &&
    body > 0 &&
    c.c <= c.l + range * 0.38
  ) {
    return "Martelo Invertido";
  }

  // 4. MARTELO (HAMMER) (Sombra inferior longa >= 2x corpo, sombra superior mínima <= 12%)
  if (
    lowerShadow >= body * 2.0 &&
    upperRatio <= 0.12 &&
    body > 0 &&
    c.c >= c.l + range * 0.62
  ) {
    return "Martelo (Hammer)";
  }

  // 5. ESTRELA CADENTE (SHOOTING STAR)
  if (
    upperShadow >= body * 2.0 &&
    lowerRatio <= 0.15 &&
    body > 0 &&
    (isBullish ? c.o <= c.l + range * 0.45 : c.c <= c.l + range * 0.45)
  ) {
    return "Estrela Cadente (Shooting Star)";
  }

  // 6. MOMENTUM (Corpo expressivo >= 70% do range que rompe o extremo anterior)
  if (bodyRatio >= 0.70 && body >= avgBody * 0.85) {
    if (isBullish && c.c > p1.h) return "Momentum de Alta";
    if (isBearish && c.c < p1.l) return "Momentum de Baixa";
  }

  // 7. ENGOLFO
  const p1Bullish = p1.c > p1.o;
  const p1Bearish = p1.c < p1.o;
  if (p1Bearish && isBullish && c.c > p1.o && c.o < p1.c) return "BullishEngulfing";
  if (p1Bullish && isBearish && c.c < p1.o && c.o > p1.c) return "BearishEngulfing";

  // 8. HARAMI
  if (p1Bullish && isBearish && c.o < p1.c && c.c > p1.o) return "BearishHarami";
  if (p1Bearish && isBullish && c.o > p1.c && c.c < p1.o) return "BullishHarami";

  // 9. DOJI
  if (body < range * 0.10) return "Doji";

  return "Sem Padrão";
}
