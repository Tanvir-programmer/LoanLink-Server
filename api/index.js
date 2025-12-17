import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { MongoClient } from "mongodb";
import { ObjectId } from "mongodb";
import Stripe from "stripe";
// ✅ Fix: Force dotenv to look in the root folder for .env
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const app = express();
app.use(cors());
app.use(express.json());
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

// --- PUBLIC ROUTES ---

app.get("/", (req, res) => {
  res.send("LoanLink Server is running");
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

// -------------------------------------------------------------
// ✅ FIXED: ADMIN ROUTES MOVED OUTSIDE OF POST /user
// -------------------------------------------------------------

// ✅ 5. GET ALL USERS (Required for ManageUsers page)
app.get("/users", async (req, res) => {
  try {
    // SECURITY NOTE: You must implement an authentication/authorization middleware here.
    const users = await db.collection("users").find({}).toArray();
    res.json(users);
  } catch (err) {
    console.error("❌ Failed to fetch all users:", err);
    res.status(500).json({ error: "Server error fetching user list" });
  }
});

// ✅ 6. UPDATE USER ROLE (Admin/Manager action)
app.patch("/users/role/:email", async (req, res) => {
  try {
    const email = req.params.email;
    const { role } = req.body;

    if (!role || typeof role !== "string") {
      return res
        .status(400)
        .json({ message: "Role field is required and must be a string." });
    }

    const validRoles = ["borrower", "manager", "admin"];
    if (!validRoles.includes(role)) {
      return res.status(400).json({
        message: `Invalid role specified. Must be one of: ${validRoles.join(
          ", "
        )}`,
      });
    }

    const filter = { email: email };
    const updateDoc = { $set: { role: role } };

    const result = await db.collection("users").updateOne(filter, updateDoc);

    if (result.matchedCount === 0) {
      return res
        .status(404)
        .json({ message: `User with email ${email} not found` });
    }

    if (result.modifiedCount === 0) {
      return res.json({
        message: `User role for ${email} is already set to ${role}`,
      });
    }

    res.json({
      message: `User role for ${email} updated to ${role} successfully`,
    });
  } catch (err) {
    console.error("❌ Failed to update user role:", err);
    res.status(500).json({ error: "Server error during role update" });
  }
});

// -------------------------------------------------------------
// USER SIGN UP / LOGIN (POST /user)
// -------------------------------------------------------------
app.post("/user", async (req, res) => {
  try {
    const usersCollection = db.collection("users");
    const userData = req.body;
    const now = new Date().toISOString();

    const query = { email: userData.email };
    const existing = await usersCollection.findOne(query);

    if (existing) {
      // User exists, just update last login time
      const result = await usersCollection.updateOne(query, {
        $set: { last_loggedIn: now },
      });
      return res.json(result);
    } // New User Registration
    const newUser = {
      ...userData,
      role: userData.role || "borrower", // Default role
      created_at: now,
      last_loggedIn: now,
    };

    const result = await usersCollection.insertOne(newUser);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// EXISTING ROUTES
// -------------------------------------------------------------
app.get("/users/:email", async (req, res) => {
  try {
    const email = req.params.email;
    const user = await db.collection("users").findOne({ email });
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// ✅ NEW: DELETE USER BY EMAIL
app.delete("/users/:email", async (req, res) => {
  try {
    const email = req.params.email;

    // Safety check: Don't allow deleting via an empty email parameter
    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    const result = await db.collection("users").deleteOne({ email: email });

    if (result.deletedCount === 1) {
      console.log(`🗑️ User deleted: ${email}`);
      res.json({ message: "User deleted successfully from database" });
    } else {
      res.status(404).json({ message: "User not found in database" });
    }
  } catch (err) {
    console.error("❌ Failed to delete user:", err);
    res.status(500).json({ error: "Server error during user deletion" });
  }
});

// ✅ 4. UPDATE LOAN BY ID
app.put("/loans/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const updatedData = req.body;
    const result = await db
      .collection("loans")
      .updateOne({ _id: new ObjectId(id) }, { $set: updatedData });

    if (result.matchedCount === 0) {
      return res.status(404).json({ message: "Loan not found" });
    }

    res.json({ message: "Loan updated successfully" });
  } catch (err) {
    console.error("❌ Failed to update loan:", err);
    res.status(500).json({ error: "Invalid ID format or server error" });
  }
});
// ✅ NEW: UPDATE LOAN APPLICATION STATUS (For Manager Approval/Rejection)
app.patch("/loan-applications/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const { status, approvedAt } = req.body;

    // Validation
    const validStatuses = ["pending", "Approved", "Rejected"];
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({ message: "Invalid status provided" });
    }

    const filter = { _id: new ObjectId(id) };
    const updateDoc = {
      $set: {
        status: status,
        // Requirement 13: Log approvedAt timestamp
        approvedAt: approvedAt || null,
      },
    };

    const result = await db
      .collection("loanApplications")
      .updateOne(filter, updateDoc);

    if (result.matchedCount === 0) {
      return res.status(404).json({ message: "Application not found" });
    }

    res.json({
      message: `Application ${status} successfully`,
      modifiedCount: result.modifiedCount,
    });
  } catch (err) {
    console.error("❌ Failed to update application status:", err);
    res.status(500).json({ error: "Server error during status update" });
  }
});
// GET a single loan application by ID
app.get("/loan-applications/:id", async (req, res) => {
  try {
    const id = req.params.id;

    // Validate if the ID is a valid MongoDB ObjectId before querying
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid ID format" });
    }

    const query = { _id: new ObjectId(id) };
    const application = await db.collection("loanApplications").findOne(query);

    if (!application) {
      return res.status(404).json({ message: "Loan application not found" });
    }

    res.status(200).json(application);
  } catch (err) {
    console.error("❌ Database Error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});
// --- GET USER ROLE ONLY ---
app.get("/user/role/:email", async (req, res) => {
  try {
    const email = req.params.email;
    const user = await db
      .collection("users")
      .findOne({ email: email }, { projection: { role: 1, _id: 0 } });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ... (other loan application routes)

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
    const { loanTitle, loanAmount, category, firstName, lastName, userEmail } =
      req.body;

    if (
      !loanTitle ||
      !loanAmount ||
      !category ||
      !firstName ||
      !lastName ||
      !userEmail
    ) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const newLoan = {
      loanTitle,
      loanAmount: Number(loanAmount),
      category,
      firstName,
      lastName,
      userEmail,
      status: "pending",
      applicationFeeStatus: "unpaid",
      application_date: new Date(),
    };

    const result = await db.collection("loanApplications").insertOne(newLoan);

    res.status(201).json({ insertedId: result.insertedId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// ✅ 1. DELETE LOAN (Requirement 12)
app.delete("/loans/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const query = { _id: new ObjectId(id) };

    const result = await db.collection("loans").deleteOne(query);

    if (result.deletedCount === 1) {
      res.json({ message: "Loan product successfully deleted" });
    } else {
      res.status(404).json({ message: "Loan product not found" });
    }
  } catch (err) {
    res.status(500).json({ error: "Invalid ID format or server error" });
  }
});

// ✅ 3. GET SINGLE LOAN (Required for the Update Loan Page)
app.get("/loans/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const loan = await db
      .collection("loans")
      .findOne({ _id: new ObjectId(id) });
    if (!loan) return res.status(404).json({ message: "Loan not found" });
    res.json(loan);
  } catch (err) {
    res.status(500).json({ error: "Invalid ID format" });
  }
});

app.get("/loan-applications/user/:email", async (req, res) => {
  try {
    const email = req.params.email;
    const loans = await db
      .collection("loanApplications")
      .find({ userEmail: email })
      .toArray();
    res.json(loans);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.delete("/loan-applications/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const result = await db
      .collection("loanApplications")
      .deleteOne({ _id: new ObjectId(id) });

    if (result.deletedCount === 1) {
      res.json({ message: "Application cancelled" });
    } else {
      res.status(404).json({ message: "Application not found" });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/pending-loans", async (req, res) => {
  try {
    const pending = await db
      .collection("loanApplications")
      .find({ status: "pending" })
      .toArray();
    res.json(pending);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update Loan Status after payment
app.patch("/loan-applications/payment/:id", async (req, res) => {
  const id = req.params.id;
  const { transactionId } = req.body;
  const filter = { _id: new ObjectId(id) };
  const updateDoc = {
    $set: {
      paymentStatus: "paid",
      transactionId: transactionId,
      paidAt: new Date().toISOString(),
    },
  };
  const result = await db
    .collection("loanApplications")
    .updateOne(filter, updateDoc);
  res.send(result);
});
app.post("/create-payment-intent", async (req, res) => {
  try {
    const { price } = req.body;
    console.log("Creating intent for price:", price);

    // Create the intent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(price * 100), // Convert to cents
      currency: "usd",
      payment_method_types: ["card"],
    });

    console.log("✅ Intent created successfully!");
    res.send({ clientSecret: paymentIntent.client_secret });
  } catch (error) {
    // 👈 THIS WILL TELL US EXACTLY WHY STRIPE IS REJECTING IT
    console.error("❌ STRIPE ERROR:", error.message);
    res.status(500).send({ error: error.message });
  }
});

app.listen(port, () => {
  console.log(`🚀 Server running on: http://localhost:${port}`);
});

export default app;
