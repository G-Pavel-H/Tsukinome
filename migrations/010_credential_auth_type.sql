-- Migration: credential auth type
-- Phase 2.1: an installation's stored secret is now either a pay-as-you-go Anthropic API key or a
-- Claude subscription OAuth token. Only the discriminator is new — the ciphertext columns are
-- untouched, so every existing row keeps working and defaults to the API-key path.

-- Up Migration
ALTER TABLE installation_credentials
  ADD COLUMN auth_type text NOT NULL DEFAULT 'api_key'
    CHECK (auth_type IN ('api_key', 'subscription'));

-- Down Migration
ALTER TABLE installation_credentials DROP COLUMN auth_type;
