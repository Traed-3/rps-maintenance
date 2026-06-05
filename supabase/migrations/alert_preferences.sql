-- Run this in Supabase → SQL Editor

-- Per-user, per-alert-type notification channel preferences
CREATE TABLE IF NOT EXISTS alert_preferences (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id      uuid NOT NULL REFERENCES profiles ON DELETE CASCADE,
  company_id      uuid NOT NULL REFERENCES companies ON DELETE CASCADE,
  alert_type      text NOT NULL,
  in_app_enabled  boolean NOT NULL DEFAULT true,
  email_enabled   boolean NOT NULL DEFAULT false,
  sms_enabled     boolean NOT NULL DEFAULT false,
  push_enabled    boolean NOT NULL DEFAULT false,
  updated_at      timestamptz DEFAULT now(),
  UNIQUE(profile_id, alert_type)
);

ALTER TABLE alert_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users manage own alert prefs"
  ON alert_preferences FOR ALL
  USING (profile_id = auth.uid());

-- Browser push notification subscriptions
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id  uuid NOT NULL REFERENCES profiles ON DELETE CASCADE,
  company_id  uuid NOT NULL REFERENCES companies ON DELETE CASCADE,
  endpoint    text NOT NULL,
  p256dh      text NOT NULL,
  auth_key    text NOT NULL,
  created_at  timestamptz DEFAULT now(),
  UNIQUE(profile_id, endpoint)
);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users manage own push subs"
  ON push_subscriptions FOR ALL
  USING (profile_id = auth.uid());
