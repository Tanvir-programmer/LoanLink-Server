import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { MongoClient, ObjectId } from "mongodb";
import Stripe from "stripe";

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const app = express();
app.use(cors());
app.use(express.json());

// stripe payment code

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const port = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGODB_URI;

if (!MONGO_URI) {
  console.error("❌ Error: MONGODB_URI is missing.");
  process.exit(1);
}

// ✅ Database Connection Logic (Serverless Friendly)
const client = new MongoClient(MONGO_URI);
let db;

async function getDb() {
  if (db) return db;
  try {
    await client.connect();
    db = client.db("loanlink");
    console.log("✅ MongoDB connected successfully");
    return db;
  } catch (err) {
    console.error("❌ MongoDB connection failed:", err);
    throw err;
  }
}

// -------------------------------------------------------------
// 🛠️ API ROUTES (JWT COMPLETELY REMOVED)
// -------------------------------------------------------------

app.get("/", (req, res) => {
  res.send("LoanLink Public Server is Active");
});

// Get all loans (Used by AllLoan.jsx)
app.get("/loans", async (req, res) => {
  try {
    const database = await getDb();
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
    const loans = await database.collection("loans").find(query).toArray();
    res.json(loans);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch loans" });
  }
});

// Get all users
app.get("/users", async (req, res) => {
  try {
    const database = await getDb();
    const users = await database.collection("users").find({}).toArray();
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: "Server error fetching users" });
  }
});

// Upsert User (Login/Register logic)
// Upsert User (Login / Register)
app.post("/user", async (req, res) => {
  try {
    const database = await getDb();
    const usersCollection = database.collection("users");

    const { name, email, image, role } = req.body;
    const now = new Date().toISOString();

    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    // ✅ Image validation (VERY IMPORTANT)
    const safeImage =
      image && image.includes("googleusercontent.com")
        ? image
        : "https://i.ibb.co/4pDNDk1/avatar.png";

    const existingUser = await usersCollection.findOne({ email });

    if (existingUser) {
      // Update last login + fix image if broken
      await usersCollection.updateOne(
        { email },
        {
          $set: {
            last_loggedIn: now,
            image: safeImage,
          },
        }
      );

      return res.json({ message: "User updated successfully" });
    }

    // New user
    const newUser = {
      name: name || "User",
      email,
      image: safeImage,
      role: role || "borrower",
      created_at: now,
      last_loggedIn: now,
    };

    await usersCollection.insertOne(newUser);
    res.status(201).json({ message: "User created successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get user role
app.get("/user/role/:email", async (req, res) => {
  try {
    const database = await getDb();
    const user = await database
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

// Get single loan details
app.get("/loans/:id", async (req, res) => {
  try {
    const database = await getDb();
    const loan = await database
      .collection("loans")
      .findOne({ _id: new ObjectId(req.params.id) });
    if (!loan) return res.status(404).json({ message: "Loan not found" });
    res.json(loan);
  } catch (err) {
    res.status(500).json({ error: "Invalid ID format" });
  }
});

// Loan Applications
app.get("/loan-applications", async (req, res) => {
  try {
    const database = await getDb();
    const applications = await database
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
    const database = await getDb();
    const result = await database.collection("loanApplications").insertOne({
      ...req.body,
      status: "pending",
      application_date: new Date(),
    });
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Stripe Payment
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

// Export for Vercel
export default app;

// Local Server for Testing
if (process.env.NODE_ENV !== "production") {
  app.listen(port, () => {
    console.log(`🚀 Local Server: http://localhost:${port}`);
  });
}
