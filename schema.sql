-- ═══════════════════════════════════════
--  Dias Architects — Database Schema
-- ═══════════════════════════════════════
CREATE DATABASE IF NOT EXISTS dias_architects
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE dias_architects;

-- Projects table (metadata only — images stored as files)
CREATE TABLE IF NOT EXISTS projects (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(255)  NOT NULL,
  category    ENUM('residential','commercial','interior','landscape') NOT NULL DEFAULT 'residential',
  year        YEAR          NOT NULL,
  filename    VARCHAR(500)  NOT NULL,         -- stored file name on disk
  original_name VARCHAR(500),                -- original upload filename
  mime_type   VARCHAR(100),
  file_size   INT UNSIGNED,                   -- bytes
  created_at  TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_category (category),
  INDEX idx_created (created_at)
);

-- Contact enquiries table
CREATE TABLE IF NOT EXISTS enquiries (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  full_name    VARCHAR(255) NOT NULL,
  phone        VARCHAR(50)  NOT NULL,
  email        VARCHAR(255),
  project_type VARCHAR(100),
  message      TEXT,
  submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_submitted (submitted_at)
);
