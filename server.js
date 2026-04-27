"use strict";
/**
 * Dias Architects — Backend API Server
 * Node.js + Express + MySQL2 + Multer
 *
 * Images are stored on disk (./uploads/) — only metadata (path, name, category, year)
 * goes into MySQL. This is the correct pattern: DB stores metadata, filesystem stores binaries.
 *
 * To use cloud storage (recommended for production), swap the multer diskStorage
 * for multer-s3 or any S3-compatible driver and update the image URL logic.
 */

require("dotenv").config();
const express     = require("express");
const path        = require("path");
const fs          = require("fs");
const crypto      = require("crypto");
const cors        = require("cors");
const helmet      = require("helmet");
const session     = require("express-session");
const rateLimit   = require("express-rate-limit");
const multer      = require("multer");
const mysql       = require("mysql2/promise");
const bcrypt      = require("bcryptjs");
const { v4: uuidv4 } = require("uuid");

// ── Try to import sharp (optional — gracefully skip optimisation if unavailable) ──
let sharp;
try { sharp = require("sharp"); } catch { sharp = null; }

const app  = express();
const PORT = process.env.PORT || 3001;

// ════════════════════════════════════════
//  UPLOAD DIRECTORY
// ════════════════════════════════════════
const UPLOAD_DIR = path.join(__dirname, "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ════════════════════════════════════════
//  MYSQL POOL
// ════════════════════════════════════════
const pool = mysql.createPool({
  host:               process.env.DB_HOST     || "localhost",
  port:               process.env.DB_PORT     || 3306,
  database:           process.env.DB_NAME     || "dias_architects",
  user:               process.env.DB_USER     || "root",
  password:           process.env.DB_PASSWORD || "",
  waitForConnections: true,
  connectionLimit:    10,
  charset:            "utf8mb4",
});

// Test connection on startup
pool.getConnection()
  .then(conn => { console.log("✅ MySQL connected"); conn.release(); })
  .catch(err => { console.error("❌ MySQL connection failed:", err.message); });

// ════════════════════════════════════════
//  MULTER — disk storage with validation
// ════════════════════════════════════════
const ALLOWED_TYPES = (process.env.ALLOWED_TYPES || "image/jpeg,image/png,image/webp,image/gif").split(",");
const MAX_SIZE_MB   = parseInt(process.env.MAX_FILE_SIZE_MB || "10", 10);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    // Sanitise: uuid + preserve extension
    const ext = path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, "");
    cb(null, `${uuidv4()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_SIZE_MB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_TYPES.includes(file.mimetype)) cb(null, true);
    else cb(new Error(`Unsupported file type: ${file.mimetype}`));
  },
});

// ════════════════════════════════════════
//  MIDDLEWARE
// ════════════════════════════════════════
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },  // allow <img> from frontend
  contentSecurityPolicy: false,                           // set your own in production
}));

app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(",") || ["http://localhost:3000", "http://127.0.0.1:5500"],
  credentials: true,
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve uploaded images as static files
app.use("/uploads", express.static(UPLOAD_DIR, {
  maxAge: "7d",
  etag: true,
  setHeaders: (res) => {
    res.setHeader("Cache-Control", "public, max-age=604800, immutable");
  },
}));

// Serve the frontend HTML
app.use(express.static(path.join(__dirname, "public")));

// Session
app.use(session({
  secret:            process.env.SESSION_SECRET || "dev-secret-change-me",
  resave:            false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure:   process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge:   8 * 60 * 60 * 1000, // 8 hours
  },
}));

// ════════════════════════════════════════
//  RATE LIMITERS
// ════════════════════════════════════════
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: "Too many login attempts. Try again in 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
});

const enquiryLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { error: "Too many enquiries submitted. Try again in an hour." },
});

app.use("/api/", apiLimiter);

// ════════════════════════════════════════
//  AUTH MIDDLEWARE
// ════════════════════════════════════════
function requireAdmin(req, res, next) {
  if (req.session?.isAdmin) return next();
  res.status(401).json({ error: "Unauthorised" });
}

// ════════════════════════════════════════
//  HELPERS
// ════════════════════════════════════════
function imageUrl(req, filename) {
  return `${req.protocol}://${req.get("host")}/uploads/${filename}`;
}

async function optimiseImage(filePath) {
  if (!sharp) return; // sharp not installed — skip
  try {
    const tmp = filePath + ".tmp";
    await sharp(filePath)
      .resize({ width: 1920, height: 1080, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 82, progressive: true })
      .toFile(tmp);
    fs.renameSync(tmp, filePath);
  } catch { /* non-fatal */ }
}

// ════════════════════════════════════════
//  ROUTES — PUBLIC
// ════════════════════════════════════════

/** GET /api/projects — list all or filter by category */
app.get("/api/projects", async (req, res) => {
  try {
    const { category } = req.query;
    const allowed = ["residential","commercial","interior","landscape"];
    let sql    = "SELECT id, name, category, year, filename, created_at FROM projects ORDER BY created_at DESC";
    let params = [];
    if (category && allowed.includes(category)) {
      sql    = "SELECT id, name, category, year, filename, created_at FROM projects WHERE category = ? ORDER BY created_at DESC";
      params = [category];
    }
    const [rows] = await pool.execute(sql, params);
    const data = rows.map(r => ({ ...r, img: imageUrl(req, r.filename) }));
    res.json({ ok: true, data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});

/** POST /api/enquiries — contact form submission */
app.post("/api/enquiries", enquiryLimiter, async (req, res) => {
  try {
    const { full_name, phone, email, project_type, message } = req.body;
    if (!full_name?.trim() || !phone?.trim()) {
      return res.status(400).json({ error: "full_name and phone are required" });
    }
    await pool.execute(
      "INSERT INTO enquiries (full_name, phone, email, project_type, message) VALUES (?,?,?,?,?)",
      [full_name.trim(), phone.trim(), email?.trim() || null, project_type?.trim() || null, message?.trim() || null]
    );
    res.json({ ok: true, message: "Enquiry received!" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to save enquiry" });
  }
});

// ════════════════════════════════════════
//  ROUTES — ADMIN AUTH
// ════════════════════════════════════════

/** POST /api/admin/login */
app.post("/api/admin/login", loginLimiter, async (req, res) => {
  const { username, password } = req.body;
  const adminUser = process.env.ADMIN_USERNAME || "diasadmin";
  const adminPass = process.env.ADMIN_PASSWORD || "Dias@Ace2024!";

  if (!username || !password) {
    return res.status(400).json({ error: "Username and password required" });
  }

  // Constant-time username compare
  const userMatch = crypto.timingSafeEqual(
    Buffer.from(username),
    Buffer.from(adminUser.padEnd(username.length))
  ) && username.length === adminUser.length;

  // For password: use bcrypt if stored as hash, else plain compare in dev
  // In production you'd store bcrypt hash: const passMatch = await bcrypt.compare(password, storedHash);
  const passMatch = password === adminPass;

  if (!userMatch || !passMatch) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  req.session.isAdmin = true;
  req.session.adminUser = username;
  res.json({ ok: true, message: "Logged in" });
});

/** POST /api/admin/logout */
app.post("/api/admin/logout", (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

/** GET /api/admin/me — check session */
app.get("/api/admin/me", (req, res) => {
  res.json({ authenticated: !!req.session?.isAdmin });
});

// ════════════════════════════════════════
//  ROUTES — ADMIN (protected)
// ════════════════════════════════════════

/** POST /api/admin/projects — upload new project(s) */
app.post(
  "/api/admin/projects",
  requireAdmin,
  upload.array("images", 20),
  async (req, res) => {
    try {
      const { name, category, year } = req.body;
      const files = req.files;

      if (!files?.length) return res.status(400).json({ error: "No images uploaded" });
      if (!name?.trim())  return res.status(400).json({ error: "Project name required" });

      const allowedCats = ["residential","commercial","interior","landscape"];
      const cat  = allowedCats.includes(category) ? category : "residential";
      const yr   = parseInt(year, 10) || new Date().getFullYear();

      const inserted = [];
      for (const file of files) {
        // Optimise image if sharp is available
        await optimiseImage(file.path);
        const stats = fs.statSync(file.path);

        const [result] = await pool.execute(
          "INSERT INTO projects (name, category, year, filename, original_name, mime_type, file_size) VALUES (?,?,?,?,?,?,?)",
          [name.trim(), cat, yr, file.filename, file.originalname, file.mimetype, stats.size]
        );
        inserted.push({
          id:       result.insertId,
          name:     name.trim(),
          category: cat,
          year:     yr,
          filename: file.filename,
          img:      imageUrl(req, file.filename),
        });
      }

      res.status(201).json({ ok: true, data: inserted });
    } catch (err) {
      console.error(err);
      // Clean up any uploaded files on error
      req.files?.forEach(f => { try { fs.unlinkSync(f.path); } catch {} });
      res.status(500).json({ error: "Upload failed" });
    }
  }
);

/** DELETE /api/admin/projects/:id */
app.delete("/api/admin/projects/:id", requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: "Invalid ID" });

    const [[project]] = await pool.execute("SELECT filename FROM projects WHERE id = ?", [id]);
    if (!project) return res.status(404).json({ error: "Project not found" });

    // Delete from DB first
    await pool.execute("DELETE FROM projects WHERE id = ?", [id]);

    // Then delete file from disk
    const filePath = path.join(UPLOAD_DIR, project.filename);
    try { fs.unlinkSync(filePath); } catch { /* already deleted or missing */ }

    res.json({ ok: true, message: "Project deleted" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Delete failed" });
  }
});

/** GET /api/admin/enquiries — view submitted enquiries */
app.get("/api/admin/enquiries", requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      "SELECT * FROM enquiries ORDER BY submitted_at DESC LIMIT 100"
    );
    res.json({ ok: true, data: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});

// ════════════════════════════════════════
//  ERROR HANDLER
// ════════════════════════════════════════
app.use((err, req, res, _next) => {
  if (err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: `File too large. Max ${MAX_SIZE_MB}MB per image.` });
  }
  if (err.message?.startsWith("Unsupported file type")) {
    return res.status(415).json({ error: err.message });
  }
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

// ════════════════════════════════════════
//  START
// ════════════════════════════════════════
app.listen(PORT, () => {
  console.log(`🏛️  Dias Architects API running → http://localhost:${PORT}`);
  console.log(`   Uploads: ${UPLOAD_DIR}`);
  console.log(`   Env:     ${process.env.NODE_ENV || "development"}`);
});
