DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS posts;

CREATE TABLE users (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  role text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin'))
);
-- username: admin@gmail.com
-- password: admin@123
INSERT INTO users (email, password_hash, role) VALUES ('admin@gmail.com', '$2a$12$NW8yjqrA6oVSZ9nh0SoyKuUFwOL0BPC1nY4UBzUgZImK9EOxs5Qmm', 'admin');

CREATE TABLE sessions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  token_hash text UNIQUE NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  user_agent text,
  ip_address text
);
CREATE INDEX idx_sessions_user_id ON sessions(user_id);

CREATE TABLE posts (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  author_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text,
  content text,
  created_at timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX idx_author_id ON posts(author_id);