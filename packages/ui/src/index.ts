export function formatPhp(centavos: bigint | string): string {
  const value = typeof centavos === "string" ? BigInt(centavos) : centavos;
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const pesos = absolute / 100n;
  const cents = (absolute % 100n).toString().padStart(2, "0");
  const grouped = new Intl.NumberFormat("en-PH", {
    maximumFractionDigits: 0,
  }).format(pesos);
  return (negative ? "-" : "") + "₱" + grouped + "." + cents;
}

export function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}
