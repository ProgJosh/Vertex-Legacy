import { Module } from "@nestjs/common";
import { APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { AppController } from "./app.controller";
import { AuthGuard } from "./common/auth.guard";
import { PermissionsGuard } from "./common/permissions.guard";
import { PrismaService } from "./services/prisma.service";
import { AuditService } from "./services/audit.service";
import { ConfigService } from "./services/config.service";
import { LedgerService } from "./services/ledger.service";
import { ProvidersService } from "./services/providers.service";
import { PaymentProviderRegistry } from "./services/payment-providers";
import { PayMongoProvider } from "./services/payment-providers/paymongo.provider";
import { XenditProvider } from "./services/payment-providers/xendit.provider";
import { FinancialService } from "./services/financial.service";
import { CommissionService } from "./services/commission.service";
import { UserService } from "./services/user.service";
import { PlanService } from "./services/plan.service";
import { BigIntInterceptor } from "./common/bigint.interceptor";

@Module({
  imports: [
    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: 120,
      },
    ]),
  ],
  controllers: [AppController],
  providers: [
    PrismaService,
    AuditService,
    ConfigService,
    LedgerService,
    ProvidersService,
    PaymentProviderRegistry,
    PayMongoProvider,
    XenditProvider,
    FinancialService,
    CommissionService,
    UserService,
    PlanService,
    { provide: APP_INTERCEPTOR, useClass: BigIntInterceptor },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
