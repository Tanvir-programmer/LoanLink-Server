import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { MongoClient, ObjectId } from "mongodb";
import Stripe from "stripe";
// import jwt from "jsonwebtoken";
// import cookieParser from "cookie-parser";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const app = express();

// ✅ CORS updated for production and local testing
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "http://localhost:5174",
      "https://loanlink1.netlify.app", // 👈 Replace with your actual frontend URL
    ],
    credentials: true,
  })
);

app.use(express.json());
// app.use(cookieParser());

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const port = process.env.PORT || 3000;

const MONGO_URI = process.env.MONGODB_URI;

if (!MONGO_URI) {
  console.error("❌ Error: MONGODB_URI is missing from your .env file.");
  process.exit(1);
}

const client = new MongoClient(MONGO_URI);
let db;

async function connectDB() {
  try {
    await client.connect();
    db = client.db("loanlink");
    console.log("✅ MongoDB connected successfully");
  } catch (err) {
    console.error("❌ MongoDB connection failed:", err);
  }
}
connectDB();

// -------------------------------------------------------------
// 🔒 JWT MIDDLEWARES (COMMENTED OUT)
// -------------------------------------------------------------
/*
const verifyToken = (req, res, next) => {
  const token = req.cookies?.token;
  if (!token) {
    return res.status(401).send({ message: "unauthorized access" });
  }
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).send({ message: "forbidden access" });
    }
    req.user = decoded;
    next();
  });
};

const verifyAdmin = async (req, res, next) => {
  const email = req.user?.email;
  const user = await db.collection("users").findOne({ email });
  if (user?.role !== "admin") {
    return res.status(403).send({ message: "Admin access only" });
  }
  next();
};

const verifyManager = async (req, res, next) => {
  const email = req.user?.email;
  const user = await db.collection("users").findOne({ email });
  if (user?.role !== "manager" && user?.role !== "admin") {
    return res.status(403).send({ message: "Manager access only" });
  }
  next();
};
*/

// -------------------------------------------------------------
// 🔑 JWT AUTH ROUTES (DISABLED)
// -------------------------------------------------------------
/*
app.post("/jwt", async (req, res) => {
  const user = req.body;
  const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: "1h" });
  res.cookie("token", token, {
      httpOnly: true,
      secure: true, // Vercel uses HTTPS
      sameSite: "none",
    }).send({ success: true });
});

app.post("/logout", (req, res) => {
  res.clearCookie("token", {
      httpOnly: true,
      secure: true,
      sameSite: "none",
    }).send({ success: true });
});
*/

// --- PUBLIC ROUTES ---
app.get("/", (req, res) => {
  res.send("LoanLink Server is running on Vercel");
});

app.get("/loans", async (req, res) => {
  try {
    const { search } = req.query;
    let query = {};
    if (search) {
      query = {
        $or: [
          { title: { $regex: search, $options: "i" } },
          { category: { $regex: search, $options: "i" } },
        ],
      };
    }
    const loans = await db.collection("loans").find(query).toArray();
    res.json(loans);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- USER ROUTES (Protection Removed for Deployment) ---
app.get("/users", async (req, res) => {
  try {
    const users = await db.collection("users").find({}).toArray();
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

app.patch("/users/role/:email", async (req, res) => {
  try {
    const { role } = req.body;
    const result = await db
      .collection("users")
      .updateOne({ email: req.params.email }, { $set: { role } });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/user", async (req, res) => {
  try {
    const userData = req.body;
    const now = new Date().toISOString();
    const existing = await db
      .collection("users")
      .findOne({ email: userData.email });
    if (existing) {
      const result = await db
        .collection("users")
        .updateOne({ email: userData.email }, { $set: { last_loggedIn: now } });
      return res.json(result);
    }
    const result = await db.collection("users").insertOne({
      ...userData,
      role: userData.role || "borrower",
      created_at: now,
      last_loggedIn: now,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/users/:email", async (req, res) => {
  try {
    const user = await db
      .collection("users")
      .findOne({ email: req.params.email });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- LOAN PRODUCT ROUTES ---
app.put("/loans/:id", async (req, res) => {
  try {
    const result = await db
      .collection("loans")
      .updateOne({ _id: new ObjectId(req.params.id) }, { $set: req.body });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/loans/:id", async (req, res) => {
  try {
    const loan = await db
      .collection("loans")
      .findOne({ _id: new ObjectId(req.params.id) });
    res.json(loan);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- LOAN APPLICATION ROUTES ---
app.get("/loan-applications", async (req, res) => {
  try {
    const applications = await db
      .collection("loanApplications")
      .find()
      .sort({ application_date: -1 })
      .toArray();
    res.json(applications);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/apply-loan", async (req, res) => {
  try {
    const result = await db.collection("loanApplications").insertOne({
      ...req.body,
      status: "pending",
      application_date: new Date(),
    });
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- STRIPE ---
app.post("/create-payment-intent", async (req, res) => {
  try {
    const { price } = req.body;
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(price * 100),
      currency: "usd",
      payment_method_types: ["card"],
    });
    res.send({ clientSecret: paymentIntent.client_secret });
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
});

app.get("/user/role/:email", async (req, res) => {
  try {
    const user = await db
      .collection("users")
      .findOne(
        { email: req.params.email },
        { projection: { role: 1, _id: 0 } }
      );
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Vercel handles the server listening, but keep this for local dev
if (process.env.NODE_ENV !== "production") {
  app.listen(port, () => {
    console.log(`🚀 Server running on: http://localhost:${port}`);
  });
}

export default app;
