import { Controller, Get, INestApplication, Module } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

@Controller("health")
class HealthController {
  @Get()
  health() {
    return { status: "ok", moneyMovement: "sandbox" };
  }
}

@Module({ controllers: [HealthController] })
class HealthTestModule {}

describe("HTTP integration", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [HealthTestModule] }).compile();
    app = module.createNestApplication();
    await app.init();
  });

  afterAll(() => app.close());

  it("serves a sandbox health response", async () => {
    const response = await request(app.getHttpServer()).get("/health").expect(200);
    expect(response.body).toEqual({ status: "ok", moneyMovement: "sandbox" });
  });
});
