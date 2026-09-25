data "aws_caller_identity" "current" {}

resource "aws_kms_key" "application" {
  description             = "Vertex Legacy application data key"
  deletion_window_in_days = 30
  enable_key_rotation     = true
}

resource "aws_secretsmanager_secret" "runtime" {
  name       = "/vertex-legacy/${var.environment}/runtime"
  kms_key_id = aws_kms_key.application.arn
}

resource "aws_s3_bucket" "documents" {
  bucket_prefix = "vertex-legacy-${var.environment}-documents-"
}

resource "aws_s3_bucket_public_access_block" "documents" {
  bucket                  = aws_s3_bucket.documents.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "documents" {
  bucket = aws_s3_bucket.documents.id
  rule {
    apply_server_side_encryption_by_default {
      kms_master_key_id = aws_kms_key.application.arn
      sse_algorithm     = "aws:kms"
    }
  }
}

resource "aws_s3_bucket_versioning" "documents" {
  bucket = aws_s3_bucket.documents.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_sqs_queue" "dead_letter" {
  name                        = "vertex-legacy-${var.environment}-dead-letter.fifo"
  fifo_queue                  = true
  content_based_deduplication = true
  kms_master_key_id           = aws_kms_key.application.arn
  message_retention_seconds   = 1209600
}

resource "aws_sqs_queue" "jobs" {
  name                        = "vertex-legacy-${var.environment}-jobs.fifo"
  fifo_queue                  = true
  content_based_deduplication = false
  kms_master_key_id           = aws_kms_key.application.arn
  visibility_timeout_seconds  = 120
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dead_letter.arn
    maxReceiveCount     = 5
  })
}

resource "aws_db_instance" "postgres" {
  identifier                   = "vertex-legacy-${var.environment}"
  engine                       = "postgres"
  engine_version               = "17"
  instance_class               = "db.r7g.large"
  allocated_storage            = 100
  max_allocated_storage        = 1000
  storage_type                 = "gp3"
  storage_encrypted            = true
  kms_key_id                   = aws_kms_key.application.arn
  multi_az                     = true
  db_name                      = "vertex_legacy"
  username                     = "vertex_runtime"
  manage_master_user_password  = true
  db_subnet_group_name         = var.database_subnet_group_name
  vpc_security_group_ids       = [var.database_security_group_id]
  backup_retention_period      = 35
  deletion_protection          = true
  performance_insights_enabled = true
  monitoring_interval          = 60
  auto_minor_version_upgrade   = true
  skip_final_snapshot          = false
  final_snapshot_identifier    = "vertex-legacy-${var.environment}-final"
}

resource "aws_elasticache_replication_group" "redis" {
  replication_group_id       = "vertex-legacy-${var.environment}"
  description                = "Vertex Legacy queues and cache"
  engine                     = "redis"
  node_type                  = "cache.r7g.large"
  num_cache_clusters         = 2
  automatic_failover_enabled = true
  multi_az_enabled           = true
  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  kms_key_id                 = aws_kms_key.application.arn
  security_group_ids         = [var.redis_security_group_id]
  subnet_group_name          = var.database_subnet_group_name
}

resource "aws_ecs_cluster" "main" {
  name = "vertex-legacy-${var.environment}"
  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_cloudwatch_log_group" "services" {
  for_each          = toset(["web", "api", "worker"])
  name              = "/ecs/vertex-legacy/${var.environment}/${each.key}"
  retention_in_days = 365
  kms_key_id        = aws_kms_key.application.arn
}

locals {
  services = {
    web    = { image = var.web_image, port = 3000, cpu = 1024, memory = 2048 }
    api    = { image = var.api_image, port = 4000, cpu = 1024, memory = 2048 }
    worker = { image = var.worker_image, port = 0, cpu = 1024, memory = 2048 }
  }
}

resource "aws_iam_role" "task_execution" {
  name = "vertex-legacy-${var.environment}-task-execution"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "ecs-tasks.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
}

resource "aws_iam_role_policy_attachment" "task_execution" {
  role       = aws_iam_role.task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role" "task" {
  name = "vertex-legacy-${var.environment}-task"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "ecs-tasks.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
}

resource "aws_iam_role_policy" "task" {
  role = aws_iam_role.task.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["secretsmanager:GetSecretValue"], Resource = [aws_secretsmanager_secret.runtime.arn] },
      { Effect = "Allow", Action = ["kms:Decrypt", "kms:Encrypt", "kms:GenerateDataKey"], Resource = [aws_kms_key.application.arn] },
      { Effect = "Allow", Action = ["s3:GetObject", "s3:PutObject"], Resource = ["${aws_s3_bucket.documents.arn}/*"] },
      { Effect = "Allow", Action = ["sqs:SendMessage", "sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"], Resource = [aws_sqs_queue.jobs.arn] }
    ]
  })
}

resource "aws_ecs_task_definition" "service" {
  for_each                 = local.services
  family                   = "vertex-legacy-${var.environment}-${each.key}"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = each.value.cpu
  memory                   = each.value.memory
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.task.arn
  container_definitions = jsonencode([{
    name      = each.key
    image     = each.value.image
    essential = true
    portMappings = each.value.port == 0 ? [] : [{ containerPort = each.value.port, protocol = "tcp" }]
    secrets = [{ name = "RUNTIME_CONFIG", valueFrom = aws_secretsmanager_secret.runtime.arn }]
    environment = [
      { name = "NODE_ENV", value = "production" },
      { name = "SQS_QUEUE_URL", value = aws_sqs_queue.jobs.url },
      { name = "S3_DOCUMENT_BUCKET", value = aws_s3_bucket.documents.bucket },
      { name = "KMS_KEY_ARN", value = aws_kms_key.application.arn }
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.services[each.key].name
        awslogs-region        = var.aws_region
        awslogs-stream-prefix = each.key
      }
    }
  }])
}

resource "aws_ecs_service" "service" {
  for_each        = local.services
  name            = each.key
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.service[each.key].arn
  desired_count   = each.key == "worker" ? 2 : 3
  launch_type     = "FARGATE"
  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [var.application_security_group_id]
    assign_public_ip = false
  }
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
}

# CloudFront, WAF, ALB listeners, certificates, DNS, and ECS target groups are
# environment-specific and must be supplied by the platform team. Do not expose
# the API or database services directly to the internet.
