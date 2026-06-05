const mysql = require("mysql2");

const db = mysql.createPool({
  host: "localhost",
  user: "root",
  password: "",
  database: "smartpark"
  //host: "mysql-smartpark.alwaysdata.net",
  //user: "smartpark",
  //password: "Noémie13@!",
  //database: "smartpark_db",
  //waitForConnections: true,
  //connectionLimit: 10,
  //queueLimit: 0
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
