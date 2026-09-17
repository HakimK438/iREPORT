CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE issues (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),

    title VARCHAR(200) NOT NULL,
    description TEXT NOT NULL,
    category VARCHAR(50) NOT NULL,

    image_url VARCHAR(500),

    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,

    severity VARCHAR(20),
    severity_score INTEGER,

    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',

    assigned_to INTEGER REFERENCES users(id),

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE issue_updates (
    id SERIAL PRIMARY KEY,

    issue_id INTEGER NOT NULL REFERENCES issues(id),

    updated_by INTEGER REFERENCES users(id),

    old_status VARCHAR(20),
    new_status VARCHAR(20) NOT NULL,

    comment TEXT,

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);