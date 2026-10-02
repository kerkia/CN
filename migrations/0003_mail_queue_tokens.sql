-- A queued confirmation / reset mail carries its link's token, so that the link's lifetime starts
-- when the mail is actually sent (see functions/_lib/mail.js).
ALTER TABLE mail_queue ADD COLUMN token_hash TEXT;
ALTER TABLE mail_queue ADD COLUMN token_ttl INTEGER;       -- ms
