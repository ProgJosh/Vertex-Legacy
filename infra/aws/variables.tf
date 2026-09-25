variable "aws_region" {
  type    = string
  default = "ap-southeast-1"
}

variable "environment" {
  type    = string
  default = "production"
}

variable "vpc_id" {
  type        = string
  description = "Existing production VPC ID."
}

variable "private_subnet_ids" {
  type        = list(string)
  description = "Private subnets across at least two availability zones."
}

variable "database_subnet_group_name" {
  type        = string
  description = "Existing RDS subnet group spanning multiple availability zones."
}

variable "application_security_group_id" {
  type        = string
  description = "Security group assigned to ECS tasks."
}

variable "database_security_group_id" {
  type        = string
  description = "Security group allowing PostgreSQL only from the application security group."
}

variable "redis_security_group_id" {
  type        = string
  description = "Security group allowing Redis only from the application security group."
}

variable "api_image" {
  type        = string
  description = "Immutable ECR image URI for the API."
}

variable "web_image" {
  type        = string
  description = "Immutable ECR image URI for the web application."
}

variable "worker_image" {
  type        = string
  description = "Immutable ECR image URI for the worker."
}
