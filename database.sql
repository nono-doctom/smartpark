CREATE TABLE Conducteur(
   id_conducteur INT AUTO_INCREMENT PRIMARY KEY,
   nom VARCHAR(50),
   prenom VARCHAR(50),
   email VARCHAR(100) UNIQUE,
   mot_de_passe VARCHAR(255),
   telephone VARCHAR(20)
);

CREATE TABLE parking(
   id_parking INT AUTO_INCREMENT PRIMARY KEY,
   nom VARCHAR(100),
   adresse VARCHAR(150),
   capacite_totale INT,
   place_disponible INT,
   latitude DOUBLE,
   longitude DOUBLE
);

CREATE TABLE type_vehicule(
   id_type INT AUTO_INCREMENT PRIMARY KEY,
   nom_type VARCHAR(50)
);

CREATE TABLE Vehicule(
   id_vehicule INT AUTO_INCREMENT PRIMARY KEY,
   plaque_immatriculation VARCHAR(20),
   id_type INT,
   id_conducteur INT,
   FOREIGN KEY (id_type) REFERENCES type_vehicule(id_type),
   FOREIGN KEY (id_conducteur) REFERENCES Conducteur(id_conducteur)
);

CREATE TABLE place(
   id_parking INT,
   num_place INT,
   id_type INT,
   PRIMARY KEY(id_parking, num_place),
   FOREIGN KEY(id_parking) REFERENCES parking(id_parking),
   FOREIGN KEY(id_type) REFERENCES type_vehicule(id_type)
);

CREATE TABLE Reservation(
   id_reservation INT AUTO_INCREMENT PRIMARY KEY,
   date_debut DATETIME,
   date_fin DATETIME,
   statut_reservation VARCHAR(20),
   id_parking INT,
   num_place INT,
   id_vehicule INT,
   FOREIGN KEY(id_parking, num_place) REFERENCES place(id_parking, num_place),
   FOREIGN KEY(id_vehicule) REFERENCES Vehicule(id_vehicule)
);
CREATE TABLE s_abonner(
   id_conducteur INT,
   id_parking INT,
   notification_importante BOOLEAN,
   PRIMARY KEY(id_conducteur, id_parking),
   FOREIGN KEY(id_conducteur) REFERENCES Conducteur(id_conducteur),
   FOREIGN KEY(id_parking) REFERENCES parking(id_parking)
);

INSERT INTO parking 
(nom, adresse, capacite_totale, place_disponible, latitude, longitude)
VALUES 

('Parking Vieux-Port', 'Marseille', 120, 35, 43.2965, 5.3698),
('Parking Prado', 'Marseille', 80, 20, 43.2695, 5.3950),
('Parking Moto Canebière', 'Marseille', 40, 15, 43.2980, 5.3740),
('Parking PMR Joliette', 'Marseille', 30, 5, 43.3050, 5.3660),

('Parking Castellane', 'Marseille', 90, 25, 43.2850, 5.3850),
('Parking Timone', 'Marseille', 110, 40, 43.2885, 5.4070),
('Parking La Valentine', 'Marseille', 150, 70, 43.2985, 5.4850),
('Parking Euromed', 'Marseille', 200, 90, 43.3080, 5.3665),
('Parking Gare Saint-Charles', 'Marseille', 130, 45, 43.3035, 5.3810),

('Parking Moto République', 'Marseille', 50, 20, 43.2960, 5.3730),
('Parking Moto Endoume', 'Marseille', 35, 10, 43.2855, 5.3520),

('Parking PMR Prado', 'Marseille', 25, 8, 43.2705, 5.3900),
('Parking PMR Castellane', 'Marseille', 20, 6, 43.2840, 5.3840),

('Parking Luminy', 'Marseille', 100, 50, 43.2310, 5.4300),
('Parking LEstaque', 'Marseille', 60, 30, 43.3620, 5.3150),
('Parking Bonneveine', 'Marseille', 95, 42, 43.2540, 5.3780),
('Parking Saint-Loup', 'Marseille', 70, 33, 43.2890, 5.4450),
('Parking Mazargues', 'Marseille', 65, 22, 43.2600, 5.4000),
('Parking Sainte-Marguerite', 'Marseille', 85, 41, 43.2700, 5.4100),
('Parking Noailles', 'Marseille', 75, 28, 43.2968, 5.3795),

('Parking Castellane Centre', 'Marseille', 140, 60, 43.2865, 5.3830),
('Parking Vélodrome Sud', 'Marseille', 180, 120, 43.2698, 5.3958),
('Parking Parc Chanot', 'Marseille', 220, 140, 43.2722, 5.3930),
('Parking Joliette Docks', 'Marseille', 160, 95, 43.3070, 5.3640),
('Parking Cours Julien', 'Marseille', 70, 30, 43.2923, 5.3842),
('Parking Belle de Mai', 'Marseille', 90, 55, 43.3130, 5.3920),
('Parking Saint-Barnabé', 'Marseille', 80, 45, 43.3005, 5.4310);
ALTER TABLE Conducteur MODIFY telephone VARCHAR(20) NULL;
ALTER TABLE Conducteur 
MODIFY id_conducteur INT NOT NULL AUTO_INCREMENT;
ALTER TABLE Vehicule 
MODIFY id_vehicule INT NOT NULL AUTO_INCREMENT;
INSERT INTO type_vehicule (nom_type) VALUES
('voiture'),
('moto'),
('handicape');

INSERT INTO place (id_parking, num_place, id_type)
SELECT 
    p.id_parking,
    n.num_place,
    CASE 
        WHEN n.num_place % 7 = 0 THEN 3
        WHEN n.num_place % 5 = 0 THEN 2
        ELSE 1
    END
FROM parking p
CROSS JOIN (
    SELECT 1 AS num_place UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5
    UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9 UNION ALL SELECT 10
) n
WHERE NOT EXISTS (
    SELECT 1 
    FROM place pl 
    WHERE pl.id_parking = p.id_parking 
    AND pl.num_place = n.num_place
);


ALTER TABLE Vehicule
ADD UNIQUE (plaque_immatriculation);
-- 1. On vide la table place pour la recréer proprement
DELETE FROM place;

-- 2. On génère les places DYNAMIQUEMENT selon la capacite_totale de chaque parking
INSERT INTO place (id_parking, num_place, id_type)
SELECT 
    p.id_parking,
    (t3.v * 100 + t2.v * 10 + t1.v + 1) AS num_place,
    CASE 
        WHEN (t3.v * 100 + t2.v * 10 + t1.v + 1) % 7 = 0 THEN 3 -- Handicap
        WHEN (t3.v * 100 + t2.v * 10 + t1.v + 1) % 5 = 0 THEN 2 -- Moto
        ELSE 1                                                 -- Voiture
    END AS id_type
FROM parking p
-- Générateur de nombres de 1 à 300
CROSS JOIN (SELECT 0 AS v UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9) t1
CROSS JOIN (SELECT 0 AS v UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9) t2
CROSS JOIN (SELECT 0 AS v UNION ALL SELECT 1 UNION ALL SELECT 2) t3
-- 💡 C'est ici que la magie opère : on s'arrête pile à la capacité maximale du parking actuel
WHERE (t3.v * 100 + t2.v * 10 + t1.v + 1) <= p.capacite_totale
ORDER BY p.id_parking, num_place;
