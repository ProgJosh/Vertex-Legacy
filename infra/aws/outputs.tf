output "document_bucket" {
  value = aws_s3_bucket.documents.bucket
}

output "job_queue_url" {
  value = aws_sqs_queue.jobs.url
}

output "runtime_secret_arn" {
  value = aws_secretsmanager_secret.runtime.arn
}

output "database_endpoint" {
  value     = aws_db_instance.postgres.endpoint
  sensitive = true
}
