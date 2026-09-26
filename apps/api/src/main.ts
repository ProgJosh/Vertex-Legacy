import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import helmet from "helmet";
import { loadEnvironment, normalizeOrigin } from "@vertex/config";
import { AppModule } from "./app.module";

async function bootstrap() {
  const env = loadEnvironment();
  const corsOrigin = normalizeOrigin(env.WEB_ORIGIN) ?? env.WEB_ORIGIN;
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.setGlobalPrefix("v1");
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
    }),
  );
  app.enableCors({
    origin: corsOrigin,
    credentials: true,
    allowedHeaders: [
      "authorization",
      "content-type",
      "idempotency-key",
      "x-demo-user",
    ],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const openApi = new DocumentBuilder()
    .setTitle("Vertex Legacy API")
    .setDescription(
      "Sandbox-first investment platform API. Live money movement is disabled by default.",
    )
    .setVersion("1.0")
    .addBearerAuth()
    .build();
  SwaggerModule.setup("docs", app, SwaggerModule.createDocument(app, openApi));

  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? process.env.API_PORT ?? env.API_PORT);
  await app.listen(port, "0.0.0.0");
  console.log(
    "Vertex Legacy API listening on " +
      port +
      " (" +
      env.NODE_ENV +
      ", auth=" +
      env.AUTH_PROVIDER +
      ", payment=" +
      env.PAYMENT_PROVIDER +
      ", payout=" +
      env.PAYOUT_PROVIDER +
      ", kyc=" +
      env.KYC_PROVIDER +
      ")",
  );
}

bootstrap();
