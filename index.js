require("dotenv").config({ path: "./.env" });
const cors = require("cors");
const express = require("express");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const uri = process.env.MONGODB_URI;
let client;
let db;
let isConnected = false;
let jobsCollection;
let usersCollection;

async function connectToMongoDB() {
  if (isConnected) return;
  client = new MongoClient(uri, {
    serverApi: {
      version: ServerApiVersion.v1,
      strict: true,
      deprecationErrors: true,
    },
  });
  await client.connect();
  db = client.db("loanlink");
  jobsCollection = db.collection("loans");
  usersCollection = db.collection("users");

  isConnected = true;
  console.log("✅ MongoDB Connected!");
}

async function startServer() {
  function obfuscateUri(u) {
    try {
      if (!u) return "not set";
      return u.replace(/:(.*)@/, ":*****@");
    } catch (e) {
      return "invalid uri";
    }
  }

  try {
    if (uri) {
      try {
        await connectToMongoDB();
      } catch (dbErr) {
        console.error(
          "MongoDB Connection Error:",
          dbErr && dbErr.message ? dbErr.message : dbErr
        );
        console.error("Obfuscated MONGODB_URI:", obfuscateUri(uri));
        console.error(
          " - Check DB username/password, percent-encode special characters, and whitelist your IP in Atlas."
        );
        console.warn("Continuing to start the server without a DB connection");
      }
    } else {
      console.warn("MONGODB_URI not set — skipping DB connection");
    }

    app.get("/", (req, res) => {
      res.send("LoanLink Server is running");
    });

    app.get("/loans", async (req, res) => {
      try {
        const loans = jobsCollection
          ? await jobsCollection.find().toArray()
          : [];
        res.send(loans);
      } catch (error) {
        res.status(500).json({ message: "Error fetching loans", error });
      }
    });
    // save or update a user in db
    app.post("/user", async (req, res) => {
      const userData = req.body;
      userData.created_at = new Date().toISOString();
      userData.last_loggedIn = new Date().toISOString();
      userData.role = "customer";

      const query = {
        email: userData.email,
      };

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
    });
    // (POST /user handler defined above)

    app.post("/apply-loan", async (req, res) => {
      const loanData = req.body;
      loanData.application_date = new Date().toISOString();
      loanData.status = "pending";
      try {
        const result = await jobsCollection.insertOne(loanData);
        res.send(result);
      } catch (error) {
        res.status(500).json({ message: "Error applying for loan", error });
      }
    });

    app.listen(port, () => {
      console.log(`🚀 Server is running on port ${port}`);
    });
  } catch (err) {
    console.error("Failed to start server", err);
    process.exit(1);
  }
}

startServer();
