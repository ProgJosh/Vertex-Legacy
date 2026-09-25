import { SetMetadata } from "@nestjs/common";

export const REQUIRED_PERMISSIONS = "vertex:permissions";
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(REQUIRED_PERMISSIONS, permissions);
