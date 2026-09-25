import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { Prisma } from "@prisma/client";
import { IS_PUBLIC } from "./public.decorator";
import { PrismaService } from "../services/prisma.service";

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  private findUser(where: Prisma.UserWhereInput) {
    return this.prisma.user.findFirst({
      where,
      include: {
        roles: {
          include: {
            role: { include: { permissions: { include: { permission: true } } } },
          },
        },
      },
    });
  }

  async canActivate(context: ExecutionContext) {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()])) {
      return true;
    }
    const request = context.switchToHttp().getRequest();
    const provider = process.env.AUTH_PROVIDER ?? "mock";
    let user;

    if (provider === "mock") {
      if (process.env.NODE_ENV === "production") {
        throw new ServiceUnavailableException("Mock authentication is disabled in production.");
      }
      const demoIdentity = request.headers["x-demo-user"];
      if (typeof demoIdentity !== "string") {
        throw new UnauthorizedException("Sign in to continue.");
      }
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        demoIdentity,
      );
      user = await this.findUser(isUuid ? { OR: [{ id: demoIdentity }, { email: demoIdentity }] } : { email: demoIdentity });
    } else {
      const authorization = request.headers.authorization;
      const token = typeof authorization === "string" ? authorization.replace(/^Bearer\s+/i, "") : "";
      if (!token) throw new UnauthorizedException("Missing bearer token.");
      const issuer =
        provider === "auth0"
          ? "https://" + process.env.AUTH0_DOMAIN + "/"
          : "https://cognito-idp." +
            process.env.AWS_REGION +
            ".amazonaws.com/" +
            process.env.COGNITO_USER_POOL_ID;
      const audience =
        provider === "auth0" ? process.env.AUTH0_AUDIENCE : process.env.COGNITO_CLIENT_ID;
      if (!audience || !process.env.AUTH0_DOMAIN && provider === "auth0") {
        throw new ServiceUnavailableException("Identity provider configuration is incomplete.");
      }
      const jwksUrl = issuer.endsWith("/")
        ? issuer + ".well-known/jwks.json"
        : issuer + "/.well-known/jwks.json";
      const result = await jwtVerify(token, createRemoteJWKSet(new URL(jwksUrl)), {
        issuer,
        audience,
      });
      if (!result.payload.sub) throw new UnauthorizedException("Token subject is missing.");
      user = await this.findUser({
        identities: { some: { provider, providerSubject: result.payload.sub } },
      });
    }

    if (!user || user.status !== "ACTIVE") throw new UnauthorizedException("Account is not active.");
    request.user = {
      id: user.id,
      email: user.email,
      roles: user.roles.map((assignment) => assignment.role.name),
      permissions: [
        ...new Set(
          user.roles.flatMap((assignment) =>
            assignment.role.permissions.map((item) => item.permission.key),
          ),
        ),
      ],
    };
    return true;
  }
}
