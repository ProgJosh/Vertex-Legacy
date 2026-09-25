import { createParamDecorator, ExecutionContext } from "@nestjs/common";

export type AuthenticatedUser = {
  id: string;
  email: string;
  permissions: string[];
  roles: string[];
};

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser =>
    context.switchToHttp().getRequest().user as AuthenticatedUser,
);
