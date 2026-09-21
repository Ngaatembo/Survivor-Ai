-- Prospect identity/contact verification.
-- Additive and safe for existing rows: old prospects remain UNVERIFIED until
-- Survivor obtains fresh corroborating evidence.
ALTER TABLE prospects ADD COLUMN verification TEXT NOT NULL DEFAULT '{}';
