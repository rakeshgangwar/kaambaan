-- Dev-only seed: a concrete tnt_dev workspace + usr_dev so DEV_AUTH requests (which present a
-- synthetic tnt_dev tenant) satisfy the catalog's foreign keys. Never run against production.
INSERT OR IGNORE INTO tenants (id, slug, name) VALUES ('tnt_dev', 'dev', 'Dev workspace');
INSERT OR IGNORE INTO users (id, email, name) VALUES ('usr_dev', 'dev@kaambaan.local', 'Dev User');
INSERT OR IGNORE INTO memberships (id, tenant_id, user_id, role) VALUES ('mbr_dev', 'tnt_dev', 'usr_dev', 'owner');
