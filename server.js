const SECRET = "smartpark_secret_key";

const express = require("express");
const cors = require("cors");
const http = require("http");
const socketIO = require("socket.io");
const db = require("./db");
const jwt = require("jsonwebtoken");

const app = express();
const server = http.createServer(app);
const io = socketIO(server, { cors: { origin: "*" } });

const PORT = 3000;

app.use(cors());
app.use(express.json());

// ------------------ MEMORY ------------------
const users = [];
const occupancy = {};
const subscriptions = {};

// ------------------ PARKING INIT ------------------
function initParking(id, total) {
  if (!occupancy[id]) {
    occupancy[id] = {};
    for (let i = 1; i <= total; i++) {
      occupancy[id][i] = Math.random() < 0.4;
    }
  }
}

// ------------------ SOCKET ------------------
io.on("connection", (socket) => {
  socket.emit("update", { occupancy });

  socket.on("subscribeParking", (parkingId) => {
    if (!subscriptions[parkingId]) subscriptions[parkingId] = [];
    if (!subscriptions[parkingId].includes(socket.id)) {
      subscriptions[parkingId].push(socket.id);
    }
  });

  socket.on("disconnect", () => {
    Object.keys(subscriptions).forEach((pid) => {
      subscriptions[pid] = subscriptions[pid].filter(id => id !== socket.id);
    });
  });
});

function emitUpdate() {
  io.emit("update", { occupancy });
}

// ------------------ AUTH ------------------
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

// ------------------ AUTH ROUTES ------------------
app.post("/api/inscrire", (req, res) => {
  const { nom, prenom, email, password } = req.body;

  if (users.find(u => u.email === email)) {
    return res.status(400).json({ error: "Email déjà utilisé" });
  }

  users.push({ id: users.length + 1, nom, prenom, email, password });
  res.json({ message: "OK" });
});

app.post("/api/login", (req, res) => {
  const { email, password } = req.body;

  const user = users.find(u => u.email === email && u.password === password);
  if (!user) return res.status(401).json({ error: "Login incorrect" });

  const token = jwt.sign({ id: user.id }, SECRET, { expiresIn: "2h" });

  res.json({ token, user });
});

// ------------------ PARKINGS ------------------
app.get("/api/parkings", (req, res) => {
  db.query("SELECT * FROM parking", (err, r) => {
    if (err) return res.status(500).json(err);
    res.json(r);
  });
});

// ------------------ PLACES ------------------
app.get("/api/places", (req, res) => {
  const id = Number(req.query.id);

  db.query("SELECT * FROM parking WHERE id_parking=?", [id], (err, r) => {
    if (err) return res.status(500).json(err);
    if (!r.length) return res.json([]);

    const parking = r[0];
    initParking(id, parking.capacite_totale);

    const result = [];

    for (let i = 1; i <= parking.capacite_totale; i++) {
      let type_place = "voiture";
      if (i % 10 === 0) type_place = "handicap";
      else if (i % 5 === 0) type_place = "moto";

      result.push({
        num_place: i,
        etat_place: occupancy[id][i] ? 1 : 0,
        type_place
      });
    }

    res.json(result);
  });
});

// ------------------ VEHICULES ------------------
app.get("/api/vehicules", verifyToken, (req, res) => {
  db.query(
    `SELECT v.id_vehicule, v.plaque_immatriculation, t.nom_type
     FROM Vehicule v
     LEFT JOIN type_vehicule t ON v.id_type = t.id_type
     WHERE v.id_conducteur = ?`,
    [req.user.id],
    (err, r) => {
      if (err) return res.status(500).json(err);
      res.json(r);
    }
  );
});

app.post("/api/vehicules", verifyToken, (req, res) => {
  const { plaque, type } = req.body;

  db.query(
    "SELECT id_type FROM type_vehicule WHERE nom_type=?",
    [type],
    (err, r) => {
      if (!r.length) return res.status(400).json({ error: "Type invalide" });

      db.query(
        `INSERT INTO Vehicule (plaque_immatriculation, id_type, id_conducteur)
         VALUES (?, ?, ?)`,
        [plaque, r[0].id_type, req.user.id],
        (err2, result) => {
          if (err2) return res.status(500).json(err2);
          res.json({ id_vehicule: result.insertId });
        }
      );
    }
  );
});

// ------------------ DELETE VEHICULE (PROFIL) ------------------
app.delete("/api/vehicules/:id", verifyToken, (req, res) => {
  const idVehicule = req.params.id;

  db.query(
    "DELETE FROM Vehicule WHERE id_vehicule=? AND id_conducteur=?",
    [idVehicule, req.user.id],
    (err) => {
      if (err) return res.status(500).json(err);

      res.json({ message: "Véhicule supprimé" });
    }
  );
});

// ------------------ RESERVATION ------------------
app.post("/api/reservation", verifyToken, (req, res) => {
  const { id_parking, num_place, id_vehicule } = req.body;

  if (!occupancy[id_parking]) initParking(id_parking, 200);

  if (occupancy[id_parking][num_place]) {
    return res.status(409).json({ error: "Place occupée" });
  }

  const typePlace =
    (num_place % 10 === 0) ? "handicap" :
    (num_place % 5 === 0) ? "moto" :
    "voiture";

  db.query(
    `SELECT t.nom_type
     FROM Vehicule v
     JOIN type_vehicule t ON v.id_type = t.id_type
     WHERE v.id_vehicule=? AND v.id_conducteur=?`,
    [id_vehicule, req.user.id],
    (err, veh) => {

      const typeVehicule = veh[0].nom_type.toLowerCase();

      const isHandicap = typeVehicule.includes("handicap");
      const isMoto = typeVehicule.includes("moto");

      if (isHandicap && typePlace !== "handicap")
        return res.status(403).json({ error: "Place handicap obligatoire" });

      if (!isHandicap && typePlace === "handicap")
        return res.status(403).json({ error: "Réservé handicap" });

      if (isMoto && typePlace !== "moto")
        return res.status(403).json({ error: "Moto uniquement" });

      occupancy[id_parking][num_place] = true;
      emitUpdate();

      const start = new Date();
      const end = new Date(Date.now() + 30 * 60000);

      db.query(
        `INSERT INTO Reservation
        (date_debut, date_fin, id_parking, num_place, id_vehicule, statut_reservation)
        VALUES (?,?,?,?,?,'active')`,
        [start, end, id_parking, num_place, id_vehicule],
        (err2, result) => {
          res.json({
            id_reservation: result.insertId,
            endTime: end
          });
        }
      );
    }
  );
});

// ------------------ CANCEL RESERVATION ------------------
app.post("/api/reservation/annuler", verifyToken, (req, res) => {
  const { id_reservation } = req.body;

  db.query(
    "SELECT * FROM Reservation WHERE id_reservation=?",
    [id_reservation],
    (err, r) => {
      const resv = r[0];

      occupancy[resv.id_parking][resv.num_place] = false;
      emitUpdate();

      db.query(
        "DELETE FROM Reservation WHERE id_reservation=?",
        [id_reservation],
        () => {
          res.json({ place: resv.num_place });
        }
      );
    }
  );
});

// ------------------ START ------------------
server.listen(PORT, () => {
  console.log("http://localhost:" + PORT);
});
