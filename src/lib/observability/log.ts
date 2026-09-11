const PREFIX = {
  WHATSAPP: "[WHATSAPP]",
  AI: "[AI]",
  ORDER: "[ORDER]",
  CART: "[CART]",
  META: "[META]",
  WEBHOOK: "[WEBHOOK]",
} as const;

export function slog(
  area: keyof typeof PREFIX,
  message: string,
  meta?: Record<string, unknown>
) {
  const safe = { ...meta };
  for (const key of Object.keys(safe)) {
    if (/token|secret|key|password|authorization/i.test(key)) delete safe[key];
  }
  if (Object.keys(safe).length) {
    console.log(`${PREFIX[area]} ${message}`, safe);
  } else {
    console.log(`${PREFIX[area]} ${message}`);
  }
}
