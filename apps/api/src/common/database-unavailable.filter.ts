import { ArgumentsHost, Catch } from "@nestjs/common";
import { BaseExceptionFilter } from "@nestjs/core";

function databaseIsRestarting(exception: unknown) {
  if (!exception || typeof exception !== "object") return false;
  const candidate = exception as { code?: unknown; message?: unknown };
  if (candidate.code === "P1001" || candidate.code === "P1017") return true;
  const message =
    typeof candidate.message === "string" ? candidate.message : "";
  return (
    message.includes("Can't reach database server") ||
    message.includes("Server has closed the connection")
  );
}

@Catch()
export class DatabaseUnavailableFilter extends BaseExceptionFilter {
  override catch(exception: unknown, host: ArgumentsHost) {
    if (!databaseIsRestarting(exception)) {
      return super.catch(exception, host);
    }
    const response = host.switchToHttp().getResponse();
    response.setHeader("Retry-After", "1");
    response.status(503).json({
      statusCode: 503,
      message:
        "The account database is waking up. Please retry this action in a moment.",
      error: "Service Unavailable",
      code: "DATABASE_RESTARTING",
    });
  }
}
