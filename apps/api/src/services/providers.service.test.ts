import { describe, expect, it } from "vitest";
import { ProvidersService } from "./providers.service";

describe("provider webhook verification", () => {
  it("verifies an intact signed payload", () => {
    const providers = new ProvidersService();
    const payload = JSON.stringify({ id: "evt_1", type: "deposit.completed" });
    expect(() => providers.verify(payload, providers.sign(payload))).not.toThrow();
  });

  it("rejects a modified payload", () => {
    const providers = new ProvidersService();
    const signature = providers.sign(JSON.stringify({ id: "evt_1" }));
    expect(() => providers.verify(JSON.stringify({ id: "evt_2" }), signature)).toThrow();
  });
});
