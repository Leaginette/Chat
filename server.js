const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const CryptoJS = require('crypto-js');

app.use(express.static(__dirname));

// Chemin absolu vers le fichier users.json
const USERS_FILE = path.join(__dirname, 'users.json');

// Fonction pour initialiser le fichier users.json s'il n'existe pas
function initUsersFile() {
    try {
        if (!fs.existsSync(USERS_FILE)) {
            fs.writeFileSync(USERS_FILE, '{}', 'utf8');
            console.log('Fichier users.json créé avec succès');
        }
    } catch (error) {
        console.error('Erreur lors de la création du fichier users.json:', error);
        process.exit(1); // Arrêter le serveur si on ne peut pas créer le fichier
    }
}

// Fonction pour charger les utilisateurs
function loadUsers() {
    try {
        const data = fs.readFileSync(USERS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Erreur lors de la lecture du fichier users.json:', error);
        return {};
    }
}

// Fonction pour sauvegarder les utilisateurs
function saveUsers(users) {
    try {
        const usersJSON = JSON.stringify(users, null, 2);
        fs.writeFileSync(USERS_FILE, usersJSON, 'utf8');
        console.log('Données sauvegardées:', usersJSON); // Pour le débogage
        return true;
    } catch (error) {
        console.error('Erreur lors de la sauvegarde des utilisateurs:', error);
        return false;
    }
}

// Initialiser le fichier au démarrage
initUsersFile();

// Charger les utilisateurs
let users = loadUsers();

// Ajouter un Set pour suivre les utilisateurs connectés
const connectedPseudos = new Set();
let connectedUsers = 0;

io.on('connection', (socket) => {
    // Réinitialiser le compteur lors de la première connexion
    if (connectedUsers === 0) {
        io.emit('userCount', 0);
    }

    connectedUsers++;
    io.emit('userCount', connectedUsers);

    // Gestion de l'inscription
    socket.on('register', (data) => {
        console.log('Tentative d\'inscription:', data);
        try {
            if (!data.pseudo || !data.password) {
                socket.emit('register-response', {
                    success: false,
                    message: "Pseudo et mot de passe requis"
                });
                return;
            }

            if (users[data.pseudo]) {
                socket.emit('register-response', {
                    success: false,
                    message: "Ce pseudo est déjà utilisé"
                });
                return;
            }

            users[data.pseudo] = {
                password: data.password,
                createdAt: new Date().toISOString()
            };

            const saved = saveUsers(users);
            console.log('Sauvegarde réussie:', saved);
            console.log('Utilisateurs actuels:', users);

            socket.emit('register-response', {
                success: true,
                message: "Compte créé avec succès"
            });
        } catch (error) {
            console.error('Erreur lors de l\'inscription:', error);
            socket.emit('register-response', {
                success: false,
                message: "Erreur serveur lors de l'inscription"
            });
        }
    });

    // Gestion de la connexion
    socket.on('login', (data) => {
        console.log('Tentative de connexion:', data);
        try {
            const user = users[data.pseudo];
            
            // Vérifier si l'utilisateur est déjà connecté
            if (connectedPseudos.has(data.pseudo)) {
                socket.emit('login-response', {
                    success: false,
                    message: "Cet utilisateur est déjà connecté sur un autre appareil"
                });
                return;
            }

            if (!user || user.password !== data.password) {
                socket.emit('login-response', {
                    success: false,
                    message: "Identifiants incorrects"
                });
                return;
            }

            console.log('Connexion réussie');
            const sessionKey = crypto.randomBytes(32).toString('hex');
            socket.sessionKey = sessionKey;
            socket.pseudo = data.pseudo;
            
            // Ajouter l'utilisateur à la liste des connectés
            connectedPseudos.add(data.pseudo);
            connectedUsers = connectedPseudos.size;
            io.emit('userCount', connectedUsers);

            socket.emit('login-response', {
                success: true,
                sessionKey: sessionKey,
                message: "Connexion réussie"
            });

            io.emit('systemMessage', `${data.pseudo} a rejoint le chat`);
        } catch (error) {
            console.error('Erreur lors de la connexion:', error);
            socket.emit('login-response', {
                success: false,
                message: "Erreur serveur lors de la connexion"
            });
        }
    });

    // Gestion des messages
    socket.on('message', (data) => {
        if (!socket.pseudo) return;

        try {
            // Déchiffrer le message
            const decrypted = CryptoJS.AES.decrypt(
                data.content,
                CryptoJS.enc.Hex.parse('0123456789abcdef0123456789abcdef'),
                {
                    iv: CryptoJS.enc.Hex.parse(data.iv)
                }
            ).toString(CryptoJS.enc.Utf8);

            // Vérifier si le message est "Ciao" ou "ciao"
            if (decrypted.toLowerCase() === "ciao") {
                // Retirer l'utilisateur de la liste des connectés
                connectedPseudos.delete(socket.pseudo);
                connectedUsers = connectedPseudos.size;
                io.emit('userCount', connectedUsers);
                
                // Envoyer un message de déconnexion au client
                socket.emit('force-disconnect', {
                    message: "Session terminée. Au revoir !"
                });
                
                // Envoyer le message système aux autres utilisateurs
                io.emit('systemMessage', `${socket.pseudo} a quitté le chat`);
                
                // Déconnecter le socket
                socket.disconnect();
                return;
            }

            // Si ce n'est pas "ciao", envoyer le message normalement
            io.emit('message', {
                pseudo: socket.pseudo,
                content: data.content,
                iv: data.iv
            });
        } catch (error) {
            console.error('Erreur lors du déchiffrement:', error);
        }
    });

    // Déconnexion
    socket.on('disconnect', () => {
        if (socket.pseudo) {
            // Retirer l'utilisateur de la liste des connectés
            connectedPseudos.delete(socket.pseudo);
            connectedUsers = connectedPseudos.size;
            io.emit('userCount', connectedUsers);
            io.emit('systemMessage', `${socket.pseudo} a quitté le chat`);
        }
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Serveur en écoute sur le port ${PORT}`);
}); 