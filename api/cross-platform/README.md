# Cross-Platform Modules

This directory contains **shared, cross-system capabilities** that are not specific
to TutTiud or any single application.

## Principles

1. **System-Agnostic**
   - Modules here must not contain any TutTiud-specific logic.
   - They must be usable by future systems (e.g., Farm Management System).

2. **Organization-Scoped**
   - Logic should operate on organizational context, not per-application context.

3. **Single Source of Truth**
   - Configuration should rely on shared org-level settings (e.g., org_settings in control DB).

4. **No Infrastructure Provisioning**
   - These modules must NOT create cloud resources (Azure, Supabase projects, Cloudflare buckets).
   - They only read/store configuration and apply business rules.

5. **Reusable APIs**
   - Exposed APIs should be generic and reusable across multiple systems.

## For AI / Code Generation
- Treat this directory as "platform-level capabilities".
- Do not introduce TutTiud domain logic here.
- Prefer generic naming: `organization`, `storage_profile`, `config`.

## Current Modules

### Storage Configuration (`storage-config/`)
Cross-system storage profile management supporting:
- BYOS (Bring Your Own Storage) with S3-compatible providers
- Managed Storage (platform-hosted)

See `storage-config/README.md` for detailed documentation.
