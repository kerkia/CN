-- Which provider sent each e-mail (2026-11-01): Resend's free plan first, Scaleway's Transactional Email beyond it
-- (functions/_lib/mail.js). NULL = sent before, by Resend.
ALTER TABLE mail_log ADD COLUMN provider TEXT;
