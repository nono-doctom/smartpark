const SECRET = "smartpark_secret_key";

const express = require("express");
const cors = require("cors");
const db = require("./db");
const path = require("path");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

console.log("🚀 SmartPark API démarrée");

// =====================
// HOME
// =====================
app.get("/", (req, res) => {
  res.send("SmartPark API OK 🚀");
});

// =====================
// AUTH MIDDLEWARE
// =====================
function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Token manquant" });
  }

  try {
    const token = authHeader.split(" ")[1];
    req.user = jwt.verify(token, SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Token invalide" });
  }
}

// =====================
// INSCRIPTION
// =====================
app.post("/api/inscrire", async (req, res) => {
  const { nom, prenom, email, password } = req.body;

  if (!nom || !prenom || !email || !password) {
    return res.status(400).json({ error: "Champs manquants" });
  }

  const hash = await bcrypt.hash(password, 12);

  db.query(
    "INSERT INTO Conducteur (nom, prenom, email, mot_de_passe) VALUES (?,?,?,?)",
    [nom, prenom, email, hash],
    (err, r) => {
      if (err) return res.status(500).json(err);

      res.json({
        message: "Inscription OK",
        id: r.insertId
      });
    }
  );
});

// =====================
// LOGIN
// =====================
app.post("/api/login", (req, res) => {
  const { email, password } = req.body;

  db.query(
    "SELECT * FROM Conducteur WHERE email=?",
    [email],
    async (err, r) => {
      if (err) return res.status(500).json({ error: "DB error" });
      if (!r.length) return res.status(401).json({ error: "Login incorrect" });

      const user = r[0];

      const ok = await bcrypt.compare(password, user.mot_de_passe);
      if (!ok) return res.status(401).json({ error: "Login incorrect" });

      const token = jwt.sign({ id: user.id_conducteur }, SECRET, {
        expiresIn: "2h"
      });

      res.json({ token, user });
    }
  );
});

// =====================
// VEHICULES (FIX COMPLET)
// =====================
app.get("/api/vehicules", verifyToken, (req, res) => {
  db.query(
    "SELECT * FROM Vehicule WHERE id_conducteur=?",
    [req.user.id],
    (err, r) => {
      if (err) return res.status(500).json(err);
      res.json(r);
    }
  );
});

app.post("/api/vehicules", verifyToken, (req, res) => {
  const { plaque } = req.body;

  db.query(
    "INSERT INTO Vehicule (plaque_immatriculation, id_conducteur) VALUES (?,?)",
    [plaque, req.user.id],
    (err) => {
      if (err) return res.status(500).json(err);
      res.json({ message: "Véhicule ajouté" });
    }
  );
});

app.delete("/api/vehicules/:id", verifyToken, (req, res) => {
  db.query(
    "DELETE FROM Vehicule WHERE id_vehicule=? AND id_conducteur=?",
    [req.params.id, req.user.id],
    (err) => {
      if (err) return res.status(500).json(err);
      res.json({ message: "Véhicule supprimé" });
    }
  );
});

// =====================
// PARKINGS
// =====================
app.get("/api/parkings", (req, res) => {
  db.query("SELECT * FROM Parking", (err, r) => {
    if (err) return res.status(500).json(err);
    res.json(r);
  });
});

// =====================
// PLACES (FIX IMPORTANT)
// =====================
app.get("/api/places", (req, res) => {
  const idParking = req.query.id;

  const sql = `
    SELECT 
      p.num_place,
      CASE 
        WHEN EXISTS (
          SELECT 1 FROM Reservation r
          WHERE r.id_parking = p.id_parking
          AND r.num_place = p.num_place
          AND r.date_fin > NOW()
        ) THEN 1
        ELSE 0
      END AS etat_place
    FROM Place p
    WHERE p.id_parking = ?
  `;

  db.query(sql, [idParking], (err, r) => {
    if (err) return res.status(500).json(err);
    res.json(r);
  });
});

// =====================
// RESERVATION
// =====================
app.post("/api/reservation", verifyToken, (req, res) => {
  const { id_parking, num_place, id_vehicule } = req.body;

  const start = new Date();
  const end = new Date(Date.now() + 30 * 60000);

  db.query(
    `SELECT * FROM Reservation 
     WHERE id_parking=? 
     AND num_place=? 
     AND date_fin > NOW()`,
    [id_parking, num_place],
    (err, r) => {
      if (err) return res.status(500).json(err);
      if (r.length) return res.status(409).json({ error: "Place occupée" });

      db.query(
        `INSERT INTO Reservation
        (date_debut, date_fin, id_parking, num_place, id_vehicule, statut_reservation)
        VALUES (?,?,?,?,?,'active')`,
        [start, end, id_parking, num_place, id_vehicule],
        (err2) => {
          if (err2) return res.status(500).json(err2);

          res.json({
            message: "Réservation OK",
            endTime: end
          });
        }
      );
    }
  );
});

// =====================
// MES RESERVATIONS (FIX 404)
// =====================
app.get("/api/mes-reservations", verifyToken, (req, res) => {
  db.query(
    `
    SELECT r.*, p.nom AS parking, v.plaque_immatriculation
    FROM Reservation r
    JOIN Vehicule v ON r.id_vehicule = v.id_vehicule
    JOIN Parking p ON p.id_parking = r.id_parking
    WHERE v.id_conducteur = ?
    ORDER BY r.date_debut DESC
    `,
    [req.user.id],
    (err, r) => {
      if (err) return res.status(500).json(err);
      res.json(r);
    }
  );
});

// =====================
// ANNULATION (FIX 400)
// =====================
app.post("/api/reservation/annuler", verifyToken, (req, res) => {
  const { id_reservation, id_vehicule } = req.body;

  if (!id_reservation && !id_vehicule) {
    return res.status(400).json({
      error: "id_reservation ou id_vehicule requis"
    });
  }

  const sql = id_reservation
    ? "DELETE FROM Reservation WHERE id_reservation=?"
    : "DELETE FROM Reservation WHERE id_vehicule=?";

  const params = id_reservation ? [id_reservation] : [id_vehicule];

  db.query(sql, params, (err, r) => {
    if (err) return res.status(500).json(err);

    res.json({
      message: "Réservation annulée",
      affected: r.affectedRows
    });
  });
});

// =====================
// AUTO CLEAN
// =====================
setInterval(() => {
  db.query("DELETE FROM Reservation WHERE date_fin < NOW()");
}, 60000);

// =====================
// START
// =====================
app.listen(PORT, () => {
  console.log("👉 http://localhost:" + PORT);
});