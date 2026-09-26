import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import helmet from "helmet";
import { AppModule } from "./app.module";

async function bootstrap() {
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
    origin: process.env.WEB_ORIGIN ?? "http://localhost:3000",
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
  await app.listen(
    Number(process.env.PORT ?? process.env.API_PORT ?? 4000),
    "0.0.0.0",
  );
}

bootstrap();
