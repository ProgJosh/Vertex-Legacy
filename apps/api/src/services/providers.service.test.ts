import { describe, expect, it, vi } from "vitest";
import { ProvidersService } from "./providers.service";
import { PaymentProviderRegistry } from "./payment-providers";

describe("provider webhook verification", () => {
  it("verifies an intact signed payload", () => {
    const registry = new PaymentProviderRegistry();
    const providers = new ProvidersService(registry);
    const payload = JSON.stringify({ id: "evt_1", type: "deposit.completed" });
    expect(providers.verify(payload, providers.sign(payload))).toBe(true);
  });

  it("rejects a modified payload", () => {
    const registry = new PaymentProviderRegistry();
    const providers = new ProvidersService(registry);
    const signature = providers.sign(JSON.stringify({ id: "evt_1" }));
    expect(providers.verify(JSON.stringify({ id: "evt_2" }), signature)).toBe(false);
  });
});
