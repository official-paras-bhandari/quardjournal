export function currency(value: number, maximumFractionDigits = 2) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits
  }).format(value);
}

export function number(value: number, maximumFractionDigits = 2) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits }).format(value);
}

export function signed(value: number, suffix = "") {
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${number(value)}${suffix}`;
}
