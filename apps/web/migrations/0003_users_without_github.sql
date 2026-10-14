-- Signing in no longer needs GitHub: an account made with an email address has no GitHub
-- login, so `login` is the GitHub login when the person has one and NULL otherwise. The
-- unique index on lower(login) keeps one row per GitHub login; NULLs never collide.
ALTER TABLE users ALTER COLUMN login DROP NOT NULL;
