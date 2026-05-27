const mysql = require("mysql2");

const db = mysql.createPool({
  host: "localhost",
  user: "root",
  password: "", // mets ton mdp mysql si tu en as un
  database: "smartpark",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// test connexion
db.getConnection((err, connection) => {
  if (err) {
    console.log("❌ Erreur MySQL :", err.message);
  } else {
    console.log("✅ Connecté à MySQL");
    connection.release();
  }
});

module.exports = db;