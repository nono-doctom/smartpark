// Importation du framework Express pour créer facilement des routes et des API Web.
const express = require("express");

// Importation du module CORS pour autoriser ou bloquer les requêtes provenant d'autres sites.
const cors = require("cors");

// Importation du module Node.js "http" pour pouvoir créer un serveur web.
const http = require("http");

// Importe la bibliothèque Socket.io pour permettre la communication en temps réel.
const socketIO = require("socket.io");

// Importe la bibliothèque jsonwebtoken pour générer et vérifier les jetons de sécurité (Tokens d'authentification).
const jwt = require("jsonwebtoken");

// Importation Bcrypt pour hacher (crypter) et vérifier les mots de passe de manière sécurisée.
const bcrypt = require("bcryptjs");

// Importation du fichier local "db.js" qui gère la connexion à la base de données MySQL.
const db = require("./db");

// Initialise l'application Express pour les requêtes HTTP.
const app = express();

// Crée un serveur HTTP standard Node.js en lui associant l'application Express.
const server = http.createServer(app);

// Clé secrète utilisée par la bibliothèque JWT pour signer et verrouiller les tokens.
const SECRET = "smartpark_secret_key";


// Définit le port d'écoute : l'hébergeur Alwaysdata (process.env.PORT) ou le port 8300 par défaut en local.
const PORT = process.env.PORT || 8300;


// Configuration du logiciel intermédiaire CORS pour autoriser uniquement pour le site Vue.js (en local ou en ligne).
app.use(cors({
  // Liste des domaines (origines) autorisés à envoyer des requêtes à ce serveur.
  origin: [
    "http://localhost:8080", // Mon application Vue.js en local.
    "https://smartpark.alwaysdata.net" // Mon application Vue.js une fois mise en ligne.
  ],
  // Permet au navigateur d'envoyer des cookies, des sessions ou des en-têtes d'authentification sécurisés.
  credentials: true
}));
// Active la lecture du format JSON qui permet au serveur de comprendre les données reçues 
// quand l'application Vue.js envoie un formulaire (comme un identifiant ou un mot de passe).
app.use(express.json());

//Le serveur distribue automatiquement les fichiers du dossier "dist" pour publier en prod sur file zile et always data.
app.use(express.static("dist"));

// Affiche un message dans la console du serveur pour indiquer que l'API SmartPark démarre.
console.log("SmartPark API démarre");

// Affiche dans la console le numéro du port sur lequel le serveur est en train de s'ouvrir (ici 8300).
console.log("PORT =", PORT);

// Initialisation de Socket.io pour activer le temps réel sur le serveur, en le liant au serveur HTTP.
const io = socketIO(server, {
  // Configuratin des autorisations d'accès spécifiques pour le temps réel
  cors: {
    // Liste des deux seuls sites internet (local et en ligne) autorisés à se connecter en temps réel à ce serveur.
    origin: [
      "http://localhost:8080",
      "https://smartpark.alwaysdata.net"
    ],
    // Autorise uniquement les méthodes d'envoi standards du web (GET sert uniquement à récupérer ou lire des informations,
    //  POST pour, envoyer, créer et modifier) à travers la connexion temps réel.
    methods: ["GET", "POST"],
    // Permet de faire passer des cookies sécurisés à travers la connexion temps réel.
    credentials: true
  },
  // Définition du chemin d'accès réseau que le site Vue.js doit utiliser pour se brancher au serveur.
  path: "/socket.io"
});


// Crée un objet vide nommé "occupancy" qui va servir de mémoire temporaire dans l'ordinateur pour suivre qui occupe quelle place à quel moment.
const occupancy = {};/* =========================
   INIT PARKING
========================= */
// Déclarer une fonction pour remplir un parking de fausses voitures si sa mémoire n'existe pas encore
function initParking(id, total = 100) {
  // Si le parking avec cet 'id' n'est pas encore enregistré dans l'objet 'occupancy' (la mémoire)
  if (!occupancy[id]) {
    // Créer un espace vide pour ce parking spécifique dans la mémoire
    occupancy[id] = {};
    // Faire une boucle qui passe sur chaque numéro de place de 1 jusqu'au nombre total de places
    for (let i = 1; i <= total; i++) {
      // Assigner aléatoirement l'état de la place (Vrai/Occupé s'il sort un chiffre inférieur à 0.4, soit 40% de chance)
      occupancy[id][i] = Math.random() < 0.4;
    }
  }
}

/*SOCKET (Gestion du Temps Réel)*/
// Écouter chaque nouvelle connexion d'un utilisateur sur le système temps réel
io.on("connection", (socket) => {
  // Afficher un message vert dans la console du serveur pour signaler qu'un écran vient de se connecter
  console.log("🟢 socket connected");

  // Envoyer immédiatement à cet utilisateur l'état complet de la mémoire du parking pour l'affichage initial
  socket.emit("update", { occupancy });

  // Écouter quand l'écran de l'utilisateur demande à s'abonner aux alertes en direct d'un parking précis
  socket.on("subscribeParking", (id) => {
    // Placer la connexion de l'utilisateur dans une "chambre virtuelle" (un salon) propre à ce parking
    socket.join(`parking_${id}`);
  });

  // Écouter quand l'écran de l'utilisateur demande à annuler ses alertes en direct pour un parking précis
  socket.on("unsubscribeParking", (id) => {
    // Faire sortir la connexion de l'utilisateur de cette "chambre virtuelle" (ce salon)
    socket.leave(`parking_${id}`);
  });
});

/*HELPERS (Outils d'envoi rapide)*/
// Fonction globale pour envoyer de force les mises à jour de places à absolument TOUS les utilisateurs connectés
function emitUpdate() {
  io.emit("update", { occupancy });
}

// Fonction pour envoyer un signal "Une place s'est libérée" uniquement aux utilisateurs présents dans la chambre de ce parking
function notifyFreePlace(parkingId) {
  io.to(`parking_${parkingId}`).emit("placeFree", {
    message: "Place disponible 🔔"
  });
}

/* AUTH (Sécurisation des accès) */
// Fonction de contrôle pour s'assurer qu'un utilisateur est bien connecté avant d'exécuter une action
function verifyToken(req, res, next) {
  // Récupérer le badge d'authentification (Authorization) envoyé dans l'en-tête de la requête HTTP
  const auth = req.headers.authorization;
  // Si aucun en-tête d'authentification n'est trouvé, bloquer le passage et renvoyer une erreur 401 (Non autorisé)
  if (!auth) return res.status(401).json({ error: "No token" });

  try {
    // Découper le texte pour extraire uniquement le jeton (en enlevant le mot "Bearer " écrit devant)
    const token = auth.split(" ")[1];
    // Décoder et vérifier la signature du jeton avec notre clé secrète. Si c'est OK, enregistre les infos de l'utilisateur dans 'req.user'
    req.user = jwt.verify(token, SECRET);
    // Autoriser le passage à l'action suivante (le contrôle est validé avec succès)
    next();
  } catch {
    // Si le jeton est faux, expiré ou corrompu, bloquer le passage et renvoyer une erreur 401
    return res.status(401).json({ error: "Invalid token" });
  }
}

/*TEST ROUTE  */
// Créer une route de test sur la racine du serveur (ex: http://localhost:8300/) pour vérifier facilement s'il est allumé
app.get("/", (req, res) => {
  // Renvoyer un message simple au format JSON disant que tout fonctionne bien
  res.json({ status: "SmartPark API OK" });
});

/*
   INSCRIPTION */
// Créer une route de type POST pour enregistrer un nouvel utilisateur sur l'application
app.post("/api/inscrire", (req, res) => {
  // Extraire les données du formulaire envoyées par l'application (nom, prénom, email, mot de passe, téléphone)
  const { nom, prenom, email, password, telephone } = req.body;

  // Lancer une recherche dans la base de données pour vérifier si cet email est déjà enregistré
  db.query(
    "SELECT * FROM Conducteur WHERE email=?",
    [email],
    (err, rows) => {
      // Si la base de données rencontre une erreur technique, renvoyer une erreur système 500
      if (err) return res.status(500).json(err);

      // Si le résultat de la recherche contient au moins une ligne, cela signifie que l'email existe déjà
      if (rows.length) {
        // Bloquer l'inscription et renvoyer une erreur 400 (Mauvaise demande)
        return res.status(400).json({ error: "Email déjà utilisé" });
      }

      // Hacher (crypter) le mot de passe de l'utilisateur avec un algorithme de sécurité (facteur de coût de 10)
      const hash = bcrypt.hashSync(password, 10);

      // Insérer officiellement le nouvel utilisateur et son mot de passe crypté dans la table Conducteur
      db.query(
        `INSERT INTO Conducteur (nom, prenom, email, mot_de_passe, telephone)
         VALUES (?,?,?,?,?)`,
        [nom, prenom, email, hash, telephone],
        (err2, result) => {
          // Si l'insertion échoue pour une raison technique, renvoyer une erreur système 500
          if (err2) return res.status(500).json(err2);

          // Si tout s'est bien passé, répondre avec un succès en fournissant le nouvel identifiant généré par la BDD
          res.json({
            message: "Inscription OK",
            id_conducteur: result.insertId
          });
        }
      );
    }
  );
});

/*LOGIN (Connexion) */
// Créer une route de type POST permettant à un utilisateur de s'authentifier
app.post("/api/login", (req, res) => {
  // Récupérer l'email et le mot de passe saisis dans le formulaire de connexion
  const { email, password } = req.body;

  // Aller chercher en base de données l'utilisateur qui possède cet email
  db.query(
    "SELECT * FROM Conducteur WHERE email=?",
    [email],
    (err, rows) => {
      // Si une erreur réseau ou BDD survient, renvoyer une erreur système 500
      if (err) return res.status(500).json(err);

      // Si aucune ligne n'est retournée, l'email n'existe pas du tout
      if (!rows.length) {
        // Renvoyer une erreur 401 (Accès refusé) avec un message flou par sécurité
        return res.status(401).json({ error: "Login incorrect" });
      }

      // Extraire le premier utilisateur trouvé dans la liste
      const user = rows[0];
      // Comparer le mot de passe saisi en clair avec le mot de passe crypté stocké dans la base de données
      const ok = bcrypt.compareSync(password, user.mot_de_passe);

      // Si la comparaison échoue (mauvais mot de passe)
      if (!ok) {
        // Renvoyer une erreur 401 (Accès refusé)
        return res.status(401).json({ error: "Login incorrect" });
      }

      // Si le mot de passe est correct, générer un jeton de sécurité (Token JWT) contenant son identifiant, valable pendant 2h
      const token = jwt.sign({ id: user.id_conducteur }, SECRET, {
        expiresIn: "2h"
      });

      // Renvoyer la réponse de succès avec le jeton et les informations de profil de l'utilisateur
      res.json({ message: "Login OK", token, user });
    }
  );
});

/*PARKINGS*/
// Créer une route de type GET pour lister tous les parkings enregistrés
app.get("/api/parkings", (req, res) => {
  // Lancer une requête SQL pour sélectionner l'intégralité des données de la table "parking"
  db.query("SELECT * FROM parking", (err, r) => {
    // Si la BDD plante, renvoyer l'erreur technique avec un statut 500
    if (err) return res.status(500).json(err);
    // Renvoyer le tableau complet des parkings à l'application Vue.js
    res.json(r);
  });
});

/*PLACES*/
// Créer une route de type GET pour construire et lister l'état des places d'un parking en particulier
app.get("/api/places", (req, res) => {
  // Récupérer le paramètre id passé dans l'adresse URL (ex: ?id=3) et s'assurer que c'est un format Nombre
  const id = Number(req.query.id);

  // Chercher le parking demandé dans la base de données pour connaître sa capacité maximale
  db.query(
    "SELECT * FROM parking WHERE id_parking=?",
    [id],
    (err, r) => {
      // En cas d'erreur de la base de données, couper et renvoyer le statut 500
      if (err) return res.status(500).json(err);
      // Si aucun parking ne correspond à cet identifiant en base de données, renvoyer une liste vide
      if (!r.length) return res.json([]);

      // Extraire le premier parking correspondant trouvé
      const parking = r[0];
      // Appeler notre fonction (créée tout en haut) pour initialiser les places aléatoirement selon la capacité totale du parking
      initParking(id, parking.capacite_totale);

      // Préparer un tableau vide qui va contenir la liste structurée des places finales
      const result = [];

      // Boucler de 1 jusqu'à la capacité totale du parking pour configurer chaque place individuellement
      for (let i = 1; i <= parking.capacite_totale; i++) {
        // Définir la catégorie par défaut de la place sur "voiture"
        let type_place = "voiture";
        // Si le numéro de la place est divisible par 7 (un reste de 0), elle devient une place "handicap"
        if (i % 7 === 0) type_place = "handicap";
        // Sinon, si le numéro de la place est divisible par 5, elle devient une place réservée "moto"
        else if (i % 5 === 0) type_place = "moto";

        // Ajouter l'objet complet configuré pour cette place à l'intérieur de notre tableau de résultats
        result.push({
          num_place: i,
          // Attribuer l'état 1 (occupé) si la mémoire 'occupancy' vaut Vrai, sinon attribuer 0 (libre)
          etat_place: occupancy[id][i] ? 1 : 0,
          type_place
        });
      }

      // Renvoyer le tableau complet des places prêtes à l'écran de l'utilisateur
      res.json(result);
    }
  );
});

/*VEHICULES*/
// Créer une route de type GET protégée par 'verifyToken' pour lister les véhicules du conducteur connecté
app.get("/api/vehicules", verifyToken, (req, res) => {
  // Lancer une requête SQL avec jointure pour récupérer la plaque et le nom textuel du type de véhicule du conducteur
  db.query(
    `SELECT v.id_vehicule, v.plaque_immatriculation, t.nom_type AS type_vehicule
     FROM Vehicule v
     LEFT JOIN type_vehicule t ON v.id_type = t.id_type
     WHERE v.id_conducteur=?`,
    [req.user.id], // Utilise l'identifiant extrait en toute sécurité du jeton JWT décodé par verifToken
    (err, r) => {
      // En cas d'erreur de la BDD, couper et envoyer le statut 500
      if (err) return res.status(500).json(err);
      // Renvoyer la liste des véhicules trouvés à l'application
      res.json(r);
    }
  );
});

// Créer une route de type POST également sécurisée pour ajouter un nouveau véhicule en base de données
app.post("/api/vehicules", verifyToken, (req, res) => {
  // Extraire la plaque d'immatriculation et le type de véhicule saisis dans le formulaire
  let { plaque, type } = req.body;

  // Si l'un des deux champs est manquant dans l'envoi
  if (!plaque || !type) {
    // Interrompre l'action et renvoyer une erreur 400 indiquant que les champs sont obligatoires
    return res.status(400).json({ error: "plaque/type requis" });
  }

  // Nettoyer le texte du type : tout mettre en minuscules et supprimer les espaces superflus au début et à la fin
  type = type.toLowerCase().trim();
  // Remplacement de sécurité : si le mot contient "handic", uniformiser l'écriture vers "handicape" pour correspondre à la BDD
  if (type.includes("handic")) type = "handicape";

  // Chercher l'identifiant numérique de ce type de véhicule dans la table de configuration 'type_vehicule'
  db.query(
    "SELECT id_type FROM type_vehicule WHERE nom_type=?",
    [type],
    (err, r) => {
      // En cas d'erreur serveur, renvoyer un statut 500
      if (err) return res.status(500).json(err);
      // Si la base de données ne trouve aucun type correspondant à ce nom
      if (!r.length) return res.status(400).json({ error: "Type invalide" });

      // Extraire l'ID numérique correspondant trouvé
      const id_type = r[0].id_type;

      // Exécuter l'insertion SQL pour ajouter le nouveau véhicule lié au conducteur connecté
      db.query(
        `INSERT INTO Vehicule (plaque_immatriculation, id_type, id_conducteur)
         VALUES (?,?,?)`,
        [plaque, id_type, req.user.id], // Utilise la plaque, l'ID trouvé et l'ID de l'utilisateur connecté
        (err2, result) => {
          // Si l'insertion échoue, renvoyer l'erreur technique avec un statut 500
          if (err2) return res.status(500).json(err2);

          // Répondre avec un message de validation en renvoyant le numéro unique du véhicule généré
          res.json({
            message: "Véhicule ajouté",
            id_vehicule: result.insertId
          });
        }
      );
    }
  );
});
// Créer une route pour supprimer un véhicule spécifique à l'aide de son identifiant passé dans l'URL (:id)
app.delete("/api/vehicules/:id", verifyToken, (req, res) => {
  // Exécuter la requête SQL pour supprimer le véhicule uniquement s'il appartient bien au conducteur connecté
  db.query(
    "DELETE FROM Vehicule WHERE id_vehicule=? AND id_conducteur=?",
    [req.params.id, req.user.id], // 'req.params.id' récupère le nombre écrit dans l'adresse URL
    (err, r) => {
      // En cas d'erreur de la base de données, couper et renvoyer le statut d'erreur 500
      if (err) return res.status(500).json(err);
      // Si aucune ligne n'a été modifiée ou supprimée en base de données (le véhicule n'existait pas ou n'était pas à lui)
      if (!r.affectedRows) return res.status(404).json({ error: "Introuvable" });

      // Renvoyer une confirmation de succès au format JSON
      res.json({ message: "Supprimé" });
    }
  );
});

// Créer une route de type POST sécurisée pour enregistrer une nouvelle réservation de place de parking
app.post("/api/reservation", verifyToken, (req, res) => {
  // Extraire l'identifiant du parking, le numéro de la place et l'ID du véhicule depuis le corps du formulaire reçu
  const { id_parking, num_place, id_vehicule } = req.body;

  // Vérifier si un des trois paramètres obligatoires est manquant
  if (!id_parking || !num_place || !id_vehicule) {
    // Bloquer l'action et renvoyer une erreur 400 pour données incomplètes
    return res.status(400).json({ error: "Données manquantes" });
  }

  // Si le parking ciblé n'a pas encore de mémoire d'occupation créée sur le serveur
  if (!occupancy[id_parking]) {
    // Initialiser par sécurité ce parking en mémoire vive avec une configuration par défaut de 200 places
    initParking(id_parking, 200);
  }

  // Vérifier si la mémoire du serveur indique que la place demandée est déjà occupée (vaut true)
  if (occupancy[id_parking][num_place]) {
    // Renvoyer une erreur de conflit 409 indiquant que la place vient d'être prise
    return res.status(409).json({ error: "Place occupée" });
  }

  //  VÉRIFICATION DU VÉHICULE ET DE SON PROPRIÉTAIRE
  // Lancer une requête SQL avec jointure pour récupérer le type du véhicule et s'assurer qu'il appartient bien à l'utilisateur connecté
  db.query(
    `SELECT v.id_vehicule, t.nom_type
     FROM Vehicule v
     JOIN type_vehicule t ON v.id_type = t.id_type
     WHERE v.id_vehicule=? AND v.id_conducteur=?`,
    [id_vehicule, req.user.id],
    (err, veh) => {

      // Si la base de données rencontre une erreur technique
      if (err) {
        console.log(err); // Afficher le détail de l'erreur dans les logs du serveur
        return res.status(500).json({ error: "Erreur serveur" });
      }

      // Si le tableau de résultats est vide, cela signifie que ce véhicule n'existe pas ou n'appartient pas à ce conducteur
      if (!veh || veh.length === 0) {
        // Bloquer l'action et renvoyer une erreur 404 (Véhicule introuvable)
        return res.status(404).json({ error: "Véhicule introuvable" });
      }

      // Récupérer le nom textuel du type de véhicule (ex: "Moto", "Voiture handicapé") et le passer en minuscules
      const typeVehicule = veh[0].nom_type.toLowerCase();

      // Déterminer la catégorie théorique de la place en fonction de son numéro (la même logique algorithmique que la route GET /places)
      const typePlace =
        (num_place % 7 === 0) ? "handicap" :
        (num_place % 5 === 0) ? "moto" :
        "voiture";

      // Créer un indicateur vrai/faux pour savoir si le véhicule de l'utilisateur correspond à un profil handicapé
      const isHandicap = typeVehicule.includes("handicap");
      // Créer un indicateur vrai/faux pour savoir si le véhicule de l'utilisateur est une moto
      const isMoto = typeVehicule.includes("moto");

      // Si le conducteur a un véhicule handicapé mais tente de réserver une place standard ou moto
      if (isHandicap && typePlace !== "handicap") {
        // Bloquer l'action et renvoyer un code 403 (Interdit) car il doit obligatoirement cibler une place adaptée
        return res.status(403).json({ error: "Place handicap obligatoire" });
      }

      // Si le conducteur n'est PAS handicapé mais tente de voler/réserver une place spécifiquement réservée PMR
      if (!isHandicap && typePlace === "handicap") {
        // Bloquer l'action et renvoyer une interdiction 403
        return res.status(403).json({ error: "Réservé handicap" });
      }

      // Si l'utilisateur conduit une moto mais essaie de prendre une place de voiture ou handicapé
      if (isMoto && typePlace !== "moto") {
        // Bloquer la réservation et renvoyer un code 403
        return res.status(403).json({ error: "Moto uniquement" });
      }

      // RÉSERVATION VALIDÉE
      // Passer instantanément la place à l'état occupé (true) dans la mémoire du serveur pour bloquer les autres utilisateurs
      occupancy[id_parking][num_place] = true;
      // Envoyer un signal WebSocket immédiat à tous les écrans connectés pour repeindre la place en rouge
      emitUpdate();

      // Enregistrer l'heure exacte du début de la réservation (instant présent)
      const start = new Date();
      // Calculer l'heure de fin de la réservation en ajoutant 30 minutes (30 fois 60 000 millisecondes) à l'instant présent
      const end = new Date(Date.now() + 30 * 60000);
      
      // Insérer officiellement la nouvelle réservation active dans la base de données MySQL
      db.query(
        `INSERT INTO Reservation
        (date_debut, date_fin, statut_reservation, id_parking, num_place, id_vehicule)
        VALUES (?, ?, ?, ?, ?, ?)`,
        [start, end, "active", id_parking, num_place, id_vehicule],
        (err2, result) => {

          // Si l'enregistrement SQL échoue
          if (err2) {
            console.log("SQL ERROR:", err2); // Logger l'erreur dans le terminal
            return res.status(500).json({ error: "Erreur SQL insert" });
          }

          // Renvoyer le numéro unique de la réservation généré et l'heure limite de fin à l'application Vue.js
          res.json({
            id_reservation: result.insertId,
            endTime: end
          });
        }
      );
    }
  );
});

// Créer une route de type POST sécurisée pour permettre à un utilisateur d'annuler sa réservation en cours
app.post("/api/reservation/annuler", verifyToken, (req, res) => {
  // Récupérer l'identifiant unique de la réservation transmis par le client
  const { id_reservation } = req.body;

  // Rechercher les détails complets de cette réservation dans la base de données
  db.query(
    "SELECT * FROM Reservation WHERE id_reservation=?",
    [id_reservation],
    (err, rows) => {

      // En cas d'erreur technique de la base de données, couper et renvoyer le statut 500
      if (err) return res.status(500).json(err);
      // Si aucune ligne n'est retournée, cela signifie que cette réservation n'existe pas
      if (!rows.length) return res.status(404).json({ error: "Introuvable" });

      // Extraire l'objet de réservation trouvé
      const r = rows[0];

      // Si la mémoire du parking concerné existe bien sur notre serveur
      if (occupancy[r.id_parking]) {
        // Libérer immédiatement la place en la passant à 'false' (libre/verte) dans la mémoire vive
        occupancy[r.id_parking][r.num_place] = false;
      }

      // Diffuser la mise à jour des places en temps réel par WebSocket à tous les écrans
      emitUpdate();

      // Supprimer définitivement la ligne de cette réservation de la table SQL
      db.query(
        "DELETE FROM Reservation WHERE id_reservation=?",
        [id_reservation],
        (err2) => {
          // Si la suppression échoue techniquement, renvoyer une erreur 500
          if (err2) return res.status(500).json(err2);

          // Renvoyer un indicateur de réussite à l'application Vue.js
          res.json({ success: true });
        }
      );
    }
  );
});

// Créer une route de type GET sécurisée pour vérifier si le conducteur connecté possède une réservation en cours
app.get("/api/reservation/active", verifyToken, (req, res) => {
  // Lancer une requête SQL avec jointure pour trouver la dernière réservation au statut 'active' liée aux véhicules de ce conducteur
  db.query(
    `SELECT r.*
     FROM Reservation r
     JOIN Vehicule v ON r.id_vehicule = v.id_vehicule
     WHERE v.id_conducteur = ?
     AND r.statut_reservation = 'active'
     ORDER BY r.id_reservation DESC
     LIMIT 1`, // Limite le résultat à 1 seule ligne pour récupérer uniquement la plus récente
    [req.user.id],
    (err, rows) => {

      // En cas d'erreur technique SQL, couper et renvoyer une erreur 500
      if (err) return res.status(500).json(err);

      // Si le tableau est vide, le conducteur n'a aucune réservation en cours
      if (!rows.length) {
        // Renvoyer la valeur 'null' pour indiquer proprement l'absence de réservation à l'application Vue.js
        return res.json(null);
      }

      // Renvoyer la réservation active trouvée au format JSON
      res.json(rows[0]);
    }
  );
});

/*CLEAN EXPIRED (Nettoyage automatique des réservations périmées) */
// Configurer un minuteur automatique (un arrière-plan permanent) qui se déclenche toutes les 60 000 ms (soit toutes les minutes)
setInterval(() => {
  // Sélectionner en base de données toutes les réservations dont l'heure de fin est inférieure à l'heure actuelle (périmées)
  db.query("SELECT * FROM Reservation WHERE date_fin < NOW()", (err, rows) => {
    // Si la base ne renvoie rien ou plante, arrêter immédiatement l'exécution de cette session de tri
    if (!rows) return;

    // Parcourir une par une toutes les réservations expirées trouvées
    rows.forEach(r => {
      // Si le parking associé à la réservation périmée est chargé en mémoire du serveur
      if (occupancy[r.id_parking]) {
        // Libérer la place en la repassant à 'false' (libre/verte) dans la mémoire vive
        occupancy[r.id_parking][r.num_place] = false;
      }
      // Envoyer une notification d'alerte WebSockets dédiée pour dire aux abonnés de ce parking qu'une place s'est libérée
      notifyFreePlace(r.id_parking);
    });

    // Supprimer définitivement toutes ces lignes de réservations périmées de la table SQL pour ne pas encombrer la BDD
    db.query("DELETE FROM Reservation WHERE date_fin < NOW()");
  });
}, 60000);

/*START SERVER pour lancer le serveur. */
// Ordonner au serveur HTTP d'écouter les requêtes entrantes sur le port configuré (PORT)
server.listen(PORT, () => {
  // Afficher une confirmation finale dans la console de commande indiquant que l'application est prête et en ligne
  console.log("RUNNING ON", PORT);
});
