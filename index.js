require("dotenv").config({ path: "./.env" });
const cors = require("cors");
const express = require("express");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const app = express();
// Vercel handles the port, so we can keep the definition but Vercel won't use app.listen
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const uri = process.env.MONGODB_URI;
let client;
let db;
let isConnected = false;
let jobsCollection; // NOTE: This collection is not used or initialized later.
let usersCollection;
let loanCollection; // NOTE: Initialized below but was missed in the original scope
let loanApplicationsCollection;

async function connectToMongoDB() {
  if (isConnected) return;

  if (!uri) {
    console.warn("MONGODB_URI not set — skipping DB connection");
    return;
  }

  try {
    client = new MongoClient(uri, {
      serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
      },
    });
    // This connects and caches the connection for subsequent calls on Vercel
    await client.connect();
    db = client.db("loanlink");
    loanCollection = db.collection("loans");
    usersCollection = db.collection("users");
    loanApplicationsCollection = db.collection("loanApplications");

    isConnected = true;
    console.log("✅ MongoDB Connected!");
  } catch (dbErr) {
    console.error("MongoDB Connection Error:", dbErr.message);
    console.warn("Continuing to serve requests without a DB connection.");
    // Do not re-throw, allow the application to proceed with failed DB connection.
  }
}

// Immediately call the DB connection to establish the connection pool
// when the Vercel serverless function starts up (it is designed to keep the connection warm).
connectToMongoDB();

// Define routes using the 'app' instance
app.get("/", (req, res) => {
  res.send("LoanLink Server is running");
});

app.get("/loans", async (req, res) => {
  if (!isConnected) {
    return res.status(503).json({ message: "Database service unavailable." });
  }
  try {
    const loans = loanCollection ? await loanCollection.find().toArray() : [];
    res.send(loans);
  } catch (error) {
    res.status(500).json({ message: "Error fetching loans", error });
  }
});

// save or update a user in db
app.post("/user", async (req, res) => {
  if (!isConnected) {
    return res.status(503).json({ message: "Database service unavailable." });
  }
  const userData = req.body;
  userData.created_at = new Date().toISOString();
  userData.last_loggedIn = new Date().toISOString();
  userData.role = "customer";

  const query = {
    email: userData.email,
  };

  try {
    const alreadyExists = await usersCollection.findOne(query);
    console.log("User Already Exists---> ", !!alreadyExists);

    if (alreadyExists) {
      console.log("Updating user info......");
      const result = await usersCollection.updateOne(query, {
        $set: {
          last_loggedIn: new Date().toISOString(),
        },
      });
      return res.send(result);
    }

    console.log("Saving new user info......");
    const result = await usersCollection.insertOne(userData);
    res.send(result);
  } catch (error) {
    res.status(500).json({ message: "Error processing user data", error });
  }
});

// NOTE: You had two identical /apply-loan handlers. I've kept the one with 'applicationFeeStatus'.
app.post("/apply-loan", async (req, res) => {
  if (!isConnected) {
    return res.status(503).json({ message: "Database service unavailable." });
  }
  const loanData = req.body;
  loanData.application_date = new Date().toISOString();
  loanData.status = "pending";
  loanData.applicationFeeStatus = "unpaid"; // Using the more detailed version

  try {
    const result = await loanApplicationsCollection.insertOne(loanData);
    res.send(result);
  } catch (error) {
    res.status(500).json({ message: "Error applying for loan", error });
  }
});

app.get("/my-loans/:email", async (req, res) => {
  if (!isConnected) {
    return res.status(503).json({ message: "Database service unavailable." });
  }
  const email = req.params.email;

  try {
    const loans = await loanApplicationsCollection
      .find({ userEmail: email })
      .toArray();
    res.send(loans);
  } catch (error) {
    res.status(500).json({ message: "Error fetching user loans", error });
  }
});

app.get("/pending-loans", async (req, res) => {
  if (!isConnected) {
    return res.status(503).json({ message: "Database service unavailable." });
  }
  try {
    const pending = await loanApplicationsCollection
      .find({ status: "pending" })
      .toArray();
    res.send(pending);
  } catch (error) {
    res.status(500).json({ message: "Error fetching pending loans", error });
  }
});

// Export the Express app instance for Vercel.
// Vercel (or any serverless environment) requires exporting the app/handler,
// not calling app.listen().
module.exports = app;

// The original `startServer` logic and `app.listen` can be removed for Vercel,
// but I'll keep the app.listen call inside a check for local development ease.
if (process.env.NODE_ENV !== "production" && process.env.VERCEL !== "1") {
  app.listen(port, () => {
    console.log(`🚀 Server is running on port ${port} (Local Dev)`);
  });
}
