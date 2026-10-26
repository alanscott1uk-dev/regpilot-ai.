export function healthPayload() {
  return { status: "ok" as const, service: "regpilot-ai" as const, mode: "prototype" as const };
}
