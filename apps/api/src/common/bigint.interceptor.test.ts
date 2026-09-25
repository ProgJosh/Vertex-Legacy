import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { serialize } from "./bigint.interceptor";

describe("financial response serialization", () => {
  it("serializes bigint centavos and Decimal rates without floating point conversion", () => {
    expect(serialize({ amountCentavos: 25_000n, feeRate: new Prisma.Decimal("0.050000") })).toEqual({
      amountCentavos: "25000",
      feeRate: "0.05",
    });
  });
});
