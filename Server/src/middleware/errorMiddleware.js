require("dotenv").config();

const errorMiddleware = (err, req, res, next) => {
  console.error("🔥 ERROR:", err);

  if (err.type === 'entity.too.large') {
    return res.status(413).json({
      success: false,
      message: 'Request payload is too large. Please reduce file sizes and try again.',
    });
  }

  // JWT verification errors must be 401 (never 500) so the client can trigger a silent refresh.
  // checkToken already handles these directly; this is a safety net for any other jwt.verify caller.
  if (err.name === 'TokenExpiredError' || err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      status:  '401',
      message: err.name === 'TokenExpiredError' ? 'Access token expired' : 'Invalid access token',
    });
  }

  res.status(err.status || 500).json({
    success: false,
    message: err.message,
    stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
  });
};

module.exports = errorMiddleware;
