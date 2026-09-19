ALTER TABLE comm_channel_state ADD COLUMN favorite boolean NOT NULL DEFAULT false;
CREATE TABLE comm_message_reactions (
 message_id integer NOT NULL REFERENCES comm_messages(id),
 user_id integer NOT NULL REFERENCES users(id),
 emoji text NOT NULL CHECK(emoji IN ('👍','❤️','🎉','👀','✅')),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(message_id,user_id,emoji)
);
CREATE TABLE comm_saved_messages (
 message_id integer NOT NULL REFERENCES comm_messages(id),
 user_id integer NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(message_id,user_id)
);
CREATE INDEX comm_saved_messages_user ON comm_saved_messages(user_id,message_id);
CREATE TABLE comm_pinned_messages (
 message_id integer PRIMARY KEY REFERENCES comm_messages(id),
 pinned_by integer NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX comm_messages_replies ON comm_messages(reply_to,id);
