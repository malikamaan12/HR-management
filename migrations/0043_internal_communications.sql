CREATE TABLE comm_channels (
 id serial PRIMARY KEY, name text NOT NULL, description text NOT NULL DEFAULT '',
 kind text NOT NULL CHECK(kind IN ('group','direct','workforce')),
 team_id integer REFERENCES workforce_teams(id), direct_key text UNIQUE,
 owner_id integer NOT NULL REFERENCES users(id), version integer NOT NULL DEFAULT 1 CHECK(version>0),
 starts_at timestamptz NOT NULL DEFAULT now(), ends_at timestamptz,
 managers_only boolean NOT NULL DEFAULT false, archived_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(ends_at IS NULL OR ends_at>starts_at),
 CHECK((kind='workforce')=(team_id IS NOT NULL)),
 CHECK(kind<>'workforce' OR ends_at IS NOT NULL), CHECK((kind='direct')=(direct_key IS NOT NULL))
);
CREATE TABLE comm_members (
 channel_id integer NOT NULL REFERENCES comm_channels(id), user_id integer NOT NULL REFERENCES users(id),
 starts_at timestamptz NOT NULL DEFAULT now(), ends_at timestamptz, removed_at timestamptz,
 PRIMARY KEY(channel_id,user_id), CHECK(ends_at IS NULL OR ends_at>starts_at)
);
CREATE INDEX comm_members_user ON comm_members(user_id,channel_id);
CREATE TABLE comm_messages (
 id serial PRIMARY KEY, channel_id integer NOT NULL REFERENCES comm_channels(id), author_id integer NOT NULL REFERENCES users(id),
 body text NOT NULL CHECK(length(body) BETWEEN 1 AND 12000), request_key uuid NOT NULL,
 reply_to integer REFERENCES comm_messages(id), mentions jsonb NOT NULL DEFAULT '[]',
 attachment_key text, attachment_name text, attachment_size integer, content_hash text NOT NULL,
 retracted_at timestamptz, retracted_by integer REFERENCES users(id), retraction_reason text,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(channel_id,author_id,request_key)
);
CREATE INDEX comm_messages_channel_id ON comm_messages(channel_id,id);
CREATE TABLE comm_channel_state (
 channel_id integer NOT NULL REFERENCES comm_channels(id), user_id integer NOT NULL REFERENCES users(id),
 last_read_id integer NOT NULL DEFAULT 0, muted boolean NOT NULL DEFAULT false,
 PRIMARY KEY(channel_id,user_id)
);
CREATE TABLE comm_bulletins (
 id serial PRIMARY KEY, legacy_id integer UNIQUE REFERENCES announcements(id),
 title text NOT NULL, body text NOT NULL, audience text NOT NULL CHECK(audience IN ('all','department','role','channel','legacy_custom')),
 target text NOT NULL DEFAULT '', status text NOT NULL CHECK(status IN ('draft','published','archived')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0), author_id integer NOT NULL REFERENCES users(id),
 publish_at timestamptz NOT NULL, expires_at timestamptz,
 requires_acknowledgement boolean NOT NULL DEFAULT false, pinned boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(), CHECK(expires_at IS NULL OR expires_at>publish_at)
);
CREATE INDEX comm_bulletins_publication ON comm_bulletins(status,publish_at,id);
CREATE TABLE comm_bulletin_receipts (
 bulletin_id integer NOT NULL REFERENCES comm_bulletins(id), user_id integer NOT NULL REFERENCES users(id),
 read_at timestamptz NOT NULL DEFAULT now(), acknowledged_at timestamptz,
 PRIMARY KEY(bulletin_id,user_id)
);
CREATE TABLE comm_notification_reads (
 notification_id integer NOT NULL REFERENCES notifications(id), user_id integer NOT NULL REFERENCES users(id),
 read_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(notification_id,user_id)
);
CREATE TABLE comm_policies (
 id serial PRIMARY KEY, version integer NOT NULL UNIQUE CHECK(version>0), definition jsonb NOT NULL,
 created_by integer NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
-- Preserve every legacy announcement, including archived/expired content. No acknowledgement is invented.
INSERT INTO comm_bulletins(legacy_id,title,body,audience,target,status,author_id,publish_at,expires_at,pinned,created_at)
 SELECT id,title,content,CASE WHEN target_audience='custom' THEN 'legacy_custom' ELSE target_audience::text END,CASE WHEN target_audience='department' THEN coalesce(target_department,'') WHEN target_audience='role' THEN coalesce(target_role,'') ELSE '' END,
 CASE WHEN is_active AND target_audience<>'custom' THEN 'published' ELSE 'archived' END,author_id,
 CASE WHEN expiry_date IS NOT NULL AND expiry_date::timestamp AT TIME ZONE 'Asia/Qatar'<=created_at AT TIME ZONE 'UTC' THEN expiry_date::timestamp AT TIME ZONE 'Asia/Qatar'-interval '1 second' ELSE created_at AT TIME ZONE 'UTC' END,
 expiry_date::timestamp AT TIME ZONE 'Asia/Qatar',coalesce(is_pinned,false),created_at AT TIME ZONE 'UTC' FROM announcements;
CREATE FUNCTION protect_comm_bulletin() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.status<>'draft' AND (NEW.title<>OLD.title OR NEW.body<>OLD.body OR NEW.audience<>OLD.audience OR NEW.target<>OLD.target OR NEW.publish_at<>OLD.publish_at OR NEW.expires_at IS DISTINCT FROM OLD.expires_at OR NEW.requires_acknowledgement<>OLD.requires_acknowledgement OR NEW.author_id<>OLD.author_id OR NEW.status='draft') THEN
  RAISE EXCEPTION 'Published announcements are immutable; publish a new announcement';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER comm_bulletin_immutable BEFORE UPDATE ON comm_bulletins FOR EACH ROW EXECUTE FUNCTION protect_comm_bulletin();
CREATE FUNCTION protect_comm_message() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.body<>OLD.body OR NEW.channel_id<>OLD.channel_id OR NEW.author_id<>OLD.author_id OR NEW.request_key<>OLD.request_key OR NEW.reply_to IS DISTINCT FROM OLD.reply_to OR NEW.mentions<>OLD.mentions OR NEW.attachment_key IS DISTINCT FROM OLD.attachment_key OR NEW.attachment_name IS DISTINCT FROM OLD.attachment_name OR NEW.attachment_size IS DISTINCT FROM OLD.attachment_size OR NEW.content_hash<>OLD.content_hash OR NEW.created_at<>OLD.created_at THEN
  RAISE EXCEPTION 'Sent messages are immutable; post a correction';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER comm_message_immutable BEFORE UPDATE ON comm_messages FOR EACH ROW EXECUTE FUNCTION protect_comm_message();
