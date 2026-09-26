import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AppController } from "../src/app.controller";
import { AuditService } from "../src/services/audit.service";
import { ConfigService } from "../src/services/config.service";
import { FinancialService } from "../src/services/financial.service";
import { PlanService } from "../src/services/plan.service";
import { PrismaService } from "../src/services/prisma.service";
import { UserService } from "../src/services/user.service";
import { ProvidersService } from "../src/services/providers.service";
import { PaymentProviderRegistry } from "../src/services/payment-providers";

describe("HTTP integration", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        { provide: PrismaService, useValue: {} },
        { provide: ConfigService, useValue: {} },
        { provide: FinancialService, useValue: {} },
        { provide: UserService, useValue: {} },
        { provide: PlanService, useValue: {} },
        { provide: AuditService, useValue: {} },
        { provide: ProvidersService, useValue: {} },
        { provide: PaymentProviderRegistry, useValue: new PaymentProviderRegistry() },
      ],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix("v1");
    await app.init();
  });

  afterEach(() => vi.unstubAllEnvs());
  afterAll(() => app.close());

  it("serves the real controller contract at /v1/health", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("PAYMENT_PROVIDER", "mock");

    const response = await request(app.getHttpServer()).get("/v1/health").expect(200);
    expect(response.body).toEqual({
      status: "ok",
      service: "vertex-legacy-api",
      moneyMovement: "sandbox",
    });
  });

  it("does not advertise live money movement in a production process", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PAYMENT_PROVIDER", "licensed");

    const response = await request(app.getHttpServer()).get("/v1/health").expect(200);
    expect(response.body.moneyMovement).toBe("disabled");
  });
});
