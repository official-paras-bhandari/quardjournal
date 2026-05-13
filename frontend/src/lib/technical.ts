import type { Candle } from "./types";

export type TechnicalPoint = {
  time: Candle["time"];
  value: number;
};

export function sma(candles: Candle[], period: number): TechnicalPoint[] {
  if (period <= 0) return [];
  return candles.map((candle, index) => {
    if (index + 1 < period) return { time: candle.time, value: Number.NaN };
    const window = candles.slice(index - period + 1, index + 1);
    const value = window.reduce((sum, item) => sum + item.close, 0) / period;
    return { time: candle.time, value };
  }).filter((point) => Number.isFinite(point.value));
}

export function ema(candles: Candle[], period: number): TechnicalPoint[] {
  if (period <= 0 || !candles.length) return [];
  const multiplier = 2 / (period + 1);
  let previous = candles[0].close;
  return candles.map((candle, index) => {
    const value = index === 0 ? candle.close : candle.close * multiplier + previous * (1 - multiplier);
    previous = value;
    return { time: candle.time, value };
  });
}

export function vwap(candles: Candle[]): TechnicalPoint[] {
  let cumulativePriceVolume = 0;
  let cumulativeVolume = 0;
  return candles.map((candle) => {
    const typicalPrice = (candle.high + candle.low + candle.close) / 3;
    cumulativePriceVolume += typicalPrice * candle.volume;
    cumulativeVolume += candle.volume;
    return {
      time: candle.time,
      value: cumulativeVolume ? cumulativePriceVolume / cumulativeVolume : candle.close
    };
  });
}

export function rsi(candles: Candle[], period = 14): TechnicalPoint[] {
  if (candles.length <= period) return [];
  const points: TechnicalPoint[] = [];
  let avgGain = 0;
  let avgLoss = 0;

  for (let i = 1; i < candles.length; i += 1) {
    const change = candles[i].close - candles[i - 1].close;
    const gain = Math.max(change, 0);
    const loss = Math.max(-change, 0);
    if (i <= period) {
      avgGain += gain;
      avgLoss += loss;
      if (i === period) {
        avgGain /= period;
        avgLoss /= period;
        points.push({ time: candles[i].time, value: calcRsi(avgGain, avgLoss) });
      }
      continue;
    }
    avgGain = ((avgGain * (period - 1)) + gain) / period;
    avgLoss = ((avgLoss * (period - 1)) + loss) / period;
    points.push({ time: candles[i].time, value: calcRsi(avgGain, avgLoss) });
  }

  return points;
}

export function macd(candles: Candle[], fast = 12, slow = 26, signal = 9) {
  const fastEma = ema(candles, fast);
  const slowEma = ema(candles, slow);
  const slowValues = new Map(slowEma.map((point) => [point.time, point.value]));
  const macdLine = fastEma
    .map((point) => {
      const slowValue = slowValues.get(point.time);
      if (slowValue === undefined) return null;
      return { time: point.time, value: point.value - slowValue };
    })
    .filter((point): point is TechnicalPoint => point !== null);

  const signalLine = ema(
    macdLine.map((point) => ({ time: point.time, open: 0, high: 0, low: 0, close: point.value, volume: 0 })),
    signal
  );
  const signalValues = new Map(signalLine.map((point) => [point.time, point.value]));
  const histogram = macdLine
    .map((point) => {
      const signalValue = signalValues.get(point.time);
      if (signalValue === undefined) return null;
      return { time: point.time, value: point.value - signalValue };
    })
    .filter((point): point is TechnicalPoint => point !== null);

  return { macdLine, signalLine, histogram };
}

export function lastPoint(points: TechnicalPoint[]) {
  return points.at(-1)?.value ?? null;
}

function calcRsi(avgGain: number, avgLoss: number) {
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}
