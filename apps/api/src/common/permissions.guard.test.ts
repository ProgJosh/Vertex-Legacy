import { describe, expect, it } from "vitest";
import { ForbiddenException } from "@nestjs/common";
import { PermissionsGuard } from "./permissions.guard";

describe("role permissions", () => {
  it("rejects an unauthorized administrator action", () => {
    const reflector = {
      getAllAndOverride: () => ["config:manage"],
    };
    const context = {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({ user: { permissions: ["user:read:self"] } }),
      }),
    };
    const guard = new PermissionsGuard(reflector as never);
    expect(() => guard.canActivate(context as never)).toThrow(ForbiddenException);
  });

  it("allows a role with the required permission", () => {
    const reflector = {
      getAllAndOverride: () => ["withdrawal:review"],
    };
    const context = {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({ user: { permissions: ["withdrawal:review"] } }),
      }),
    };
    const guard = new PermissionsGuard(reflector as never);
    expect(guard.canActivate(context as never)).toBe(true);
  });
});
