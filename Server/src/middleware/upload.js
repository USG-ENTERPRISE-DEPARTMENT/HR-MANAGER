const multer  = require('multer');
const path    = require('path');
const crypto  = require('crypto');
const fs      = require('fs');

const UPLOAD_DIR = path.join(__dirname, '../../uploads/documents');

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename:    (_req, file, cb) => {
    const ext      = path.extname(file.originalname).toLowerCase();
    const secret   = process.env.DOC_SECRET || 'hr_doc_secret_key';
    const random   = crypto.randomBytes(16).toString('hex');
    const hash     = crypto.createHmac('sha256', secret).update(random).digest('hex');
    cb(null, `${hash}${ext}`);
  },
});

const ALLOWED = ['.pdf', '.jpg', '.jpeg', '.png', '.gif', '.webp'];

const fileFilter = (_req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (ALLOWED.includes(ext)) cb(null, true);
  else cb(new Error(`Only ${ALLOWED.join(', ')} files are allowed`), false);
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB per file
});

// In-memory CSV upload (attendance imports) — kept separate because the
// document filter above only allows pdf/jpg/png
const csvUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.csv', '.txt'].includes(ext)) cb(null, true);
    else cb(new Error('Only .csv or .txt files are allowed — save Excel sheets as CSV first'), false);
  },
  limits: { fileSize: 10 * 1024 * 1024 },
});

module.exports = { upload, csvUpload, UPLOAD_DIR };
