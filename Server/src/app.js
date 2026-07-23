//IMPORTS
require("dotenv").config();

const cookieParser = require("cookie-parser");
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const credentials = require("./middleware/credentials");
const corsOptions = require("./middleware/corsOption");
const errorMiddleware = require("./middleware/errorMiddleware");



//create express app and get port for connection
const app = express(); //create express app

//middleware setup
app.use(credentials); 				//handle options credentials check - before CORS!
app.use(cors(corsOptions));			//cross origin resource sharing setup 

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: false, limit: '50mb' }));
app.use(cookieParser());
app.use(morgan(process.env.LOG_LEVEL));

// Per-request async context (lets the Prisma audit middleware know the acting user).
app.use(require('./middleware/requestContext').withRequest);

BigInt.prototype.toJSON = function () {
  return this.toString();
};

// Admin-editable response messages: swap any static message for its override on the way out. This
// wraps res.json so it covers respond.*, inline res.json, and the error middleware alike.
const messageStore = require('./helpers/messageStore');
messageStore.reload();  // load overrides into memory at boot
app.use((req, res, next) => {
  const orig = res.json.bind(res);
  res.json = (body) => {
    if (body && typeof body.message === 'string') body.message = messageStore.applyOverride(body.message);
    return orig(body);
  };
  next();
});

//base route for the app
app.use("/v1/api/hr", require("./routes/routes"));

// Background jobs
require('./helpers/cronHelper');

//catch all errors
app.use(errorMiddleware);










module.exports = app;