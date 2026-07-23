require("dotenv").config({
  path: `.env.${process.env.NODE_ENV || "development"}`
});

const app = require("./src/app");

app.listen(process.env.PORT, () => {
  console.log(`🚀 Server running on port ${process.env.PORT}`);
});

