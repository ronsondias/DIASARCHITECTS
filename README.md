# Dias Architects — Backend Setup Guide

## Architecture

```
Browser (index.html)
    ↓ fetch() REST API
Express Server (server.js)
    ↓ SQL queries (metadata only)
MySQL (projects, enquiries tables)
    ↑
Disk (./uploads/*.jpg) ← actual image files
```

**Images are stored as files on disk. MySQL only stores the filename + metadata.**
This is the correct pattern — databases are for structured data, not binary blobs.

---

## 1. Prerequisites

- Node.js 18+
- MySQL 8.0+ (or MariaDB 10.6+)

---

## 2. MySQL Setup

```sql
-- Run schema.sql in your MySQL client:
mysql -u root -p < schema.sql
```

---

## 3. Install Dependencies

```bash
npm install
```

Optional but recommended — install Sharp for automatic image optimisation (resize + compress on upload):
```bash
npm install sharp
```

---

## 4. Configure Environment

```bash
cp .env.example .env
# Edit .env with your MySQL credentials and a strong SESSION_SECRET
```

Key variables in `.env`:
```
DB_HOST=localhost
DB_PORT=3306
DB_NAME=dias_architects
DB_USER=your_mysql_user
DB_PASSWORD=your_mysql_password
SESSION_SECRET=a-very-long-random-string-here
ADMIN_USERNAME=diasadmin
ADMIN_PASSWORD=Dias@Ace2024!    ← change this!
PORT=3001
```

---

## 5. Start the Server

```bash
# Development (auto-restart on changes):
npm run dev

# Production:
npm start
```

Server runs at: http://localhost:3001

---

## 6. Update Frontend API URL

In `public/index.html`, find:
```js
const API = "http://localhost:3001/api";
```
Change to your production domain before deploying:
```js
const API = "https://api.diasarchitects.in/api";
```

---

## API Reference

### Public
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/projects` | List all projects |
| GET | `/api/projects?category=residential` | Filter by category |
| POST | `/api/enquiries` | Submit contact form |

### Admin (requires login session)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/admin/login` | Login |
| POST | `/api/admin/logout` | Logout |
| GET | `/api/admin/me` | Check session |
| POST | `/api/admin/projects` | Upload new project (multipart/form-data) |
| DELETE | `/api/admin/projects/:id` | Delete a project |
| GET | `/api/admin/enquiries` | View all enquiries |

---

## Production Recommendations

1. **HTTPS** — Run behind Nginx with SSL (Let's Encrypt)
2. **Change admin password** — Update `ADMIN_PASSWORD` in `.env`
3. **Move to cloud storage** — For multi-server setups, replace `multer.diskStorage` with `multer-s3` pointing to AWS S3 or any S3-compatible bucket (Cloudflare R2, DigitalOcean Spaces)
4. **Nginx config** — Serve `public/` as static files via Nginx, proxy `/api/` to Node
5. **PM2** — Use `pm2 start server.js` to keep the server alive

---

## File Structure

```
dias-architects/
├── server.js          ← Express API server
├── schema.sql         ← MySQL table definitions
├── package.json
├── .env.example       ← Copy to .env and fill in
├── uploads/           ← Uploaded images (auto-created)
│   └── *.jpg
└── public/
    └── index.html     ← The website frontend
```
