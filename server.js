const express = require("express");
const cors = require("cors");
const http = require("http");
const socketIO = require("socket.io");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const db = require("./db");

const app = express();
const server = http.createServer(app);

const SECRET = "smartpark_secret_key";

/* =========================
   PORT ALWAYSDATA (FIX OBLIGATOIRE)
========================= */
const PORT = process.env.PORT || 8300;

/* =========================
   MIDDLEWARE
========================= */
app.use(cors({
  origin: [
    "http://localhost:8080",
    "https://smartpark.alwaysdata.net"
  ],
  credentials: true
}));

app.use(express.json());
app.use(express.static("dist"));

console.log("🚀 SmartPark API INIT");
console.log("👉 PORT =", PORT);

/* =========================
   SOCKET.IO
========================= */
const io = socketIO(server, {
  cors: {
    origin: [
      "http://localhost:8080",
      "https://smartpark.alwaysdata.net"
    ],
    methods: ["GET", "POST"],
    credentials: true
  },
  path: "/socket.io"
});

/* =========================
   MEMORY
========================= */
const occupancy = {};

/* =========================
   INIT PARKING
========================= */
function initParking(id, total = 100) {
  if (!occupancy[id]) {
    occupancy[id] = {};
    for (let i = 1; i <= total; i++) {
      occupancy[id][i] = Math.random() < 0.4;
    }
  }
}

/* =========================
   SOCKET
========================= */
io.on("connection", (socket) => {
  console.log("🟢 socket connected");

  socket.emit("update", { occupancy });

  socket.on("subscribeParking", (id) => {
    socket.join(`parking_${id}`);
  });

  socket.on("unsubscribeParking", (id) => {
    socket.leave(`parking_${id}`);
  });
});

/* =========================
   HELPERS
========================= */
function emitUpdate() {
  io.emit("update", { occupancy });
}

function notifyFreePlace(parkingId) {
  io.to(`parking_${parkingId}`).emit("placeFree", {
    message: "Place disponible 🔔"
  });
}

/* =========================
   AUTH
========================= */
function verifyToken(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: "No token" });

  try {
    const token = auth.split(" ")[1];
    req.user = jwt.verify(token, SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}

/* =========================
   TEST ROUTE (IMPORTANT)
========================= */
app.get("/", (req, res) => {
  res.json({ status: "SmartPark API OK" });
});

/* =========================
   INSCRIPTION
========================= */
app.post("/api/inscrire", (req, res) => {
  const { nom, prenom, email, password, telephone } = req.body;

  db.query(
    "SELECT * FROM Conducteur WHERE email=?",
    [email],
    (err, rows) => {
      if (err) return res.status(500).json(err);

      if (rows.length) {
        return res.status(400).json({ error: "Email déjà utilisé" });
      }

      const hash = bcrypt.hashSync(password, 10);

      db.query(
        `INSERT INTO Conducteur (nom, prenom, email, mot_de_passe, telephone)
         VALUES (?,?,?,?,?)`,
        [nom, prenom, email, hash, telephone],
        (err2, result) => {
          if (err2) return res.status(500).json(err2);

          res.json({
            message: "Inscription OK",
            id_conducteur: result.insertId
          });
        }
      );
    }
  );
});

/* =========================
   LOGIN
========================= */
app.post("/api/login", (req, res) => {
  const { email, password } = req.body;

  db.query(
    "SELECT * FROM Conducteur WHERE email=?",
    [email],
    (err, rows) => {
      if (err) return res.status(500).json(err);

      if (!rows.length) {
        return res.status(401).json({ error: "Login incorrect" });
      }

      const user = rows[0];
      const ok = bcrypt.compareSync(password, user.mot_de_passe);

      if (!ok) {
        return res.status(401).json({ error: "Login incorrect" });
      }

      const token = jwt.sign({ id: user.id_conducteur }, SECRET, {
        expiresIn: "2h"
      });

      res.json({ message: "Login OK", token, user });
    }
  );
});

/* =========================
   PARKINGS
========================= */
app.get("/api/parkings", (req, res) => {
  db.query("SELECT * FROM parking", (err, r) => {
    if (err) return res.status(500).json(err);
    res.json(r);
  });
});

/* =========================
   PLACES
========================= */
app.get("/api/places", (req, res) => {
  const id = Number(req.query.id);

  db.query(
    "SELECT * FROM parking WHERE id_parking=?",
    [id],
    (err, r) => {
      if (err) return res.status(500).json(err);
      if (!r.length) return res.json([]);

      const parking = r[0];
      initParking(id, parking.capacite_totale);

      const result = [];

      for (let i = 1; i <= parking.capacite_totale; i++) {
        let type_place = "voiture";
        if (i % 7 === 0) type_place = "handicap";
        else if (i % 5 === 0) type_place = "moto";

        result.push({
          num_place: i,
          etat_place: occupancy[id][i] ? 1 : 0,
          type_place
        });
      }

      res.json(result);
    }
  );
});

/* =========================
   VEHICULES
========================= */
app.get("/api/vehicules", verifyToken, (req, res) => {
  db.query(
    `SELECT v.id_vehicule, v.plaque_immatriculation, t.nom_type AS type_vehicule
     FROM Vehicule v
     LEFT JOIN type_vehicule t ON v.id_type = t.id_type
     WHERE v.id_conducteur=?`,
    [req.user.id],
    (err, r) => {
      if (err) return res.status(500).json(err);
      res.json(r);
    }
  );
});

app.post("/api/vehicules", verifyToken, (req, res) => {
  let { plaque, type } = req.body;

  if (!plaque || !type) {
    return res.status(400).json({ error: "plaque/type requis" });
  }

  type = type.toLowerCase().trim();
  if (type.includes("handic")) type = "handicape";

  db.query(
    "SELECT id_type FROM type_vehicule WHERE nom_type=?",
    [type],
    (err, r) => {
      if (err) return res.status(500).json(err);
      if (!r.length) return res.status(400).json({ error: "Type invalide" });

      const id_type = r[0].id_type;

      db.query(
        `INSERT INTO Vehicule (plaque_immatriculation, id_type, id_conducteur)
         VALUES (?,?,?)`,
        [plaque, id_type, req.user.id],
        (err2, result) => {
          if (err2) return res.status(500).json(err2);

          res.json({
            message: "Véhicule ajouté",
            id_vehicule: result.insertId
          });
        }
      );
    }
  );
});

app.delete("/api/vehicules/:id", verifyToken, (req, res) => {
  db.query(
    "DELETE FROM Vehicule WHERE id_vehicule=? AND id_conducteur=?",
    [req.params.id, req.user.id],
    (err, r) => {
      if (err) return res.status(500).json(err);
      if (!r.affectedRows) return res.status(404).json({ error: "Introuvable" });

      res.json({ message: "Supprimé" });
    }
  );
});app.post("/api/reservation", verifyToken, (req, res) => {
  const { id_parking, num_place, id_vehicule } = req.body;

  if (!id_parking || !num_place || !id_vehicule) {
    return res.status(400).json({ error: "Données manquantes" });
  }

  // init parking memory
  if (!occupancy[id_parking]) {
    initParking(id_parking, 200);
  }

  // place déjà prise
  if (occupancy[id_parking][num_place]) {
    return res.status(409).json({ error: "Place occupée" });
  }

  // 🔥 vérifier véhicule + propriétaire
  db.query(
    `SELECT v.id_vehicule, t.nom_type
     FROM Vehicule v
     JOIN type_vehicule t ON v.id_type = t.id_type
     WHERE v.id_vehicule=? AND v.id_conducteur=?`,
    [id_vehicule, req.user.id],
    (err, veh) => {

      if (err) {
        console.log(err);
        return res.status(500).json({ error: "Erreur serveur" });
      }

      if (!veh || veh.length === 0) {
        return res.status(404).json({ error: "Véhicule introuvable" });
      }

      const typeVehicule = veh[0].nom_type.toLowerCase();

      const typePlace =
        (num_place % 7 === 0) ? "handicap" :
        (num_place % 5 === 0) ? "moto" :
        "voiture";

      const isHandicap = typeVehicule.includes("handicap");
      const isMoto = typeVehicule.includes("moto");

      if (isHandicap && typePlace !== "handicap") {
        return res.status(403).json({ error: "Place handicap obligatoire" });
      }

      if (!isHandicap && typePlace === "handicap") {
        return res.status(403).json({ error: "Réservé handicap" });
      }

      if (isMoto && typePlace !== "moto") {
        return res.status(403).json({ error: "Moto uniquement" });
      }

      // réservation OK
      occupancy[id_parking][num_place] = true;
      emitUpdate();

      const start = new Date();
      const end = new Date(Date.now() + 30 * 60000);

      db.query(
        `INSERT INTO Reservation
         (date_debut, date_fin, statut_reservation, id_parking, num_place, id_vehicule)
         VALUES (?,?,?,?,?,'active')`,
        [start, end, id_parking, num_place, id_vehicule],
        (err2, result) => {

          if (err2) {
            console.log("SQL ERROR:", err2);
            return res.status(500).json({ error: "Erreur SQL insert" });
          }

          res.json({
            id_reservation: result.insertId,
            endTime: end
          });
        }
      );
    }
  );
});app.post("/api/reservation/annuler", verifyToken, (req, res) => {
  const { id_reservation } = req.body;

  db.query(
    "SELECT * FROM Reservation WHERE id_reservation=?",
    [id_reservation],
    (err, rows) => {

      if (err) return res.status(500).json(err);
      if (!rows.length) return res.status(404).json({ error: "Introuvable" });

      const r = rows[0];

      if (occupancy[r.id_parking]) {
        occupancy[r.id_parking][r.num_place] = false;
      }

      emitUpdate();

      db.query(
        "DELETE FROM Reservation WHERE id_reservation=?",
        [id_reservation],
        (err2) => {
          if (err2) return res.status(500).json(err2);

          res.json({ success: true });
        }
      );
    }
  );
});app.get("/api/reservation/active", verifyToken, (req, res) => {
  db.query(
    `SELECT r.*
     FROM Reservation r
     JOIN Vehicule v ON r.id_vehicule = v.id_vehicule
     WHERE v.id_conducteur = ?
     AND r.statut_reservation = 'active'
     ORDER BY r.id_reservation DESC
     LIMIT 1`,
    [req.user.id],
    (err, rows) => {

      if (err) return res.status(500).json(err);

      if (!rows.length) {
        return res.json(null);
      }

      res.json(rows[0]);
    }
  );
});
/* =========================
   CLEAN EXPIRED
========================= */
setInterval(() => {
  db.query("SELECT * FROM Reservation WHERE date_fin < NOW()", (err, rows) => {
    if (!rows) return;

    rows.forEach(r => {
      if (occupancy[r.id_parking]) {
        occupancy[r.id_parking][r.num_place] = false;
      }
      notifyFreePlace(r.id_parking);
    });

    db.query("DELETE FROM Reservation WHERE date_fin < NOW()");
  });
}, 60000);

/* =========================
   START SERVER
========================= */
server.listen(PORT, () => {
  console.log("🚀 RUNNING ON", PORT);
});
