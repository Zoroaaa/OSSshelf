# Multi-Bucket Migration Guide

## Overview

OSSshelf now supports multi-vendor, multi-bucket storage management.
Files are routed to the correct bucket automatically based on:
1. The file's explicit `bucket_id` (set when uploading into a bucket-assigned folder)
2. Walking up the parent folder chain to find the nearest bucket assignment
3. The user's default bucket
4. Legacy fallback: the `FILES` R2 direct binding (backwards compatibility)

## Steps

### 1. Run database migrations

```bash
# Apply all pending migrations
wrangler d1 migrations apply r2shelf-db

# Or for production
wrangler d1 migrations apply r2shelf-db --env production
```

Migrations applied:
- `0003_storage_buckets.sql` — creates `storage_buckets` table, adds `bucket_id` to `files`
- `0004_bucket_quota_and_file_bucket.sql` — adds `storage_quota` to `storage_buckets`, index on `files.bucket_id`

### 2. Add storage buckets in-app

Log in → Settings → 存储桶管理 → 添加存储桶

Configure at least one bucket with your credentials. The first bucket added
is automatically set as the default.

### 3. (Optional) Remove the legacy R2 binding

Once you've confirmed new uploads are routing correctly, you can remove the
`[[r2_buckets]]` binding from `wrangler.toml`. Existing files uploaded before
migration will continue to work as long as the binding is present.

## Legacy File Handling

Files uploaded before the migration have `bucket_id = NULL`. When the system
encounters such a file during download/preview/delete:
1. It first checks for a configured storage bucket (via parent chain / default)
2. If none found, falls back to `c.env.FILES` (the old R2 direct binding)

This means legacy files continue to work without any data migration.

## Bucket Assignment Logic

- **Root-level folders**: The bucket selector appears in the "新建文件夹" dialog
- **Sub-folders**: Inherit the parent folder's bucket (no selector shown)
- **File uploads**: Use the bucket of the parent folder, or the default bucket

## Per-Bucket Quotas

Set a storage quota (in GB) for each bucket in 存储桶管理.
When a bucket's quota is reached, uploads to that bucket are blocked.
The overall user quota (set in user settings) remains as a global cap.
