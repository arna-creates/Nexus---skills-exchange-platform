
DROP TABLE IF EXISTS certificates CASCADE;
DROP TABLE IF EXISTS ratings CASCADE;
DROP TABLE IF EXISTS sessions CASCADE;
DROP TABLE IF EXISTS user_skill CASCADE;
DROP TABLE IF EXISTS skill CASCADE;
DROP TABLE IF EXISTS profile CASCADE;
DROP TABLE IF EXISTS users CASCADE;


CREATE TABLE users (
    user_id             SERIAL PRIMARY KEY,
    name                VARCHAR(100) NOT NULL,
    email               VARCHAR(100) NOT NULL UNIQUE,
    password            VARCHAR(255) NOT NULL,          -- bcrypt hash
    phone               VARCHAR(15),
    verification_status VARCHAR(20) NOT NULL DEFAULT 'UNVERIFIED'
                        CHECK (verification_status IN ('UNVERIFIED','VERIFIED')),
    availability        VARCHAR(100),
    role                VARCHAR(20) NOT NULL DEFAULT 'Learner' 
                        CHECK (role IN ('Learner', 'Mentor', 'Both')),
    average_rating      REAL NOT NULL DEFAULT 0.00,
    created_at          TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE profile (
    profile_id     SERIAL PRIMARY KEY,
    user_id        INT NOT NULL UNIQUE REFERENCES users(user_id) ON DELETE CASCADE,
    bio            VARCHAR(300),
    interests      VARCHAR(100),
    availability   VARCHAR(100)
);

CREATE TABLE skill (
    skill_id     SERIAL PRIMARY KEY,
    skill_name   VARCHAR(100) NOT NULL UNIQUE,
    category     VARCHAR(50),
    description  VARCHAR(300)
);

CREATE TABLE user_skill (
    user_skill_id    SERIAL PRIMARY KEY,
    user_id          INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    skill_id         INT NOT NULL REFERENCES skill(skill_id) ON DELETE CASCADE,
    skill_type       VARCHAR(5) NOT NULL CHECK (skill_type IN ('OFFER','WANT')),
    experience_level VARCHAR(30) NOT NULL CHECK (experience_level IN ('Beginner','Intermediate','Advanced','Expert')),
    description      VARCHAR(300),
    portfolio_link   VARCHAR(200),
    preferred_timing VARCHAR(100),
    UNIQUE (user_id, skill_id, skill_type)
);


CREATE TABLE sessions (
    session_id     SERIAL PRIMARY KEY,
    learner_id     INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    mentor_id      INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    skill_id       INT REFERENCES skill(skill_id) ON DELETE SET NULL,
    session_date   DATE,
    session_time   TIME,
    status         VARCHAR(20) NOT NULL DEFAULT 'Requested' 
                   CHECK (status IN ('Requested', 'Approved', 'Completed', 'Rejected'))
);

CREATE TABLE ratings (
    rating_id      SERIAL PRIMARY KEY,
    session_id     INT NOT NULL UNIQUE REFERENCES sessions(session_id) ON DELETE CASCADE,
    mentor_id      INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    rating         INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    feedback       TEXT,
    created_date   TIMESTAMP NOT NULL DEFAULT NOW()
);


CREATE TABLE certificates (
    certificate_id      SERIAL PRIMARY KEY,
    mentor_id           INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    certificate_name    VARCHAR(150) NOT NULL,
    certificate_details TEXT,
    issue_date          DATE NOT NULL DEFAULT CURRENT_DATE,
    verification_status VARCHAR(20) NOT NULL DEFAULT 'Pending' 
                        CHECK (verification_status IN ('Pending', 'Verified', 'Rejected'))
);

CREATE INDEX idx_user_skill_user  ON user_skill(user_id);
CREATE INDEX idx_user_skill_skill ON user_skill(skill_id);
CREATE INDEX idx_skill_category   ON skill(category);
CREATE INDEX idx_sessions_users   ON sessions(learner_id, mentor_id);

INSERT INTO skill (skill_name, category, description) VALUES
 ('Python',         'Programming', 'General purpose programming'),
 ('JavaScript',     'Programming', 'Web programming'),
 ('SQL',            'Programming', 'Relational databases'),
 ('UI/UX Design',   'Design',      'Interface and experience design'),
 ('Public Speaking','Communication','Presentations and speeches'),
 ('Spanish',        'Language',    'Spanish language'),
 ('Guitar',         'Music',       'Acoustic and electric guitar');