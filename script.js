class SecureChat {
    constructor() {
        this.socket = io();
        this.pseudo = '';
        this.sessionKey = null;
        this.isRegistering = false;
        this.loginAttempts = 0;
        this.maxAttempts = 3;
        this.isLocked = false;
        this.key = CryptoJS.enc.Hex.parse('0123456789abcdef0123456789abcdef');
        this.setupAuthUI();
        this.setupSocketListeners();
    }

    setupAuthUI() {
        const authToggleButtons = document.querySelectorAll('.auth-toggle button');
        const authBtn = document.getElementById('auth-btn');
        const confirmPassword = document.querySelector('.confirm-password');

        authToggleButtons.forEach(button => {
            button.addEventListener('click', () => {
                if (button.dataset.mode === 'register') {
                    this.showAdminPasswordDialog().then(isAdmin => {
                        if (isAdmin) {
                            authToggleButtons.forEach(b => b.classList.remove('active'));
                            button.classList.add('active');
                            this.isRegistering = true;
                            confirmPassword.style.display = 'block';
                            authBtn.querySelector('span').textContent = 'INSCRIPTION_';
                        }
                    });
                } else {
                    authToggleButtons.forEach(b => b.classList.remove('active'));
                    button.classList.add('active');
                    this.isRegistering = false;
                    confirmPassword.style.display = 'none';
                    authBtn.querySelector('span').textContent = 'CONNEXION_';
                }
            });
        });

        authBtn.addEventListener('click', () => this.handleAuth());

        document.querySelectorAll('.input-group input').forEach(input => {
            input.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this.handleAuth();
                }
            });
        });
    }

    async handleAuth() {
        const pseudo = document.getElementById('pseudo').value.trim();
        const password = document.getElementById('password').value;
        
        if (!this.validateInputs(pseudo, password)) return;

        try {
            if (this.isRegistering) {
                await this.register(pseudo, password);
            } else {
                await this.login(pseudo, password);
            }
        } catch (error) {
            console.error('Erreur:', error);
            this.showError("Une erreur est survenue");
        }
    }

    validateInputs(pseudo, password) {
        if (!pseudo || pseudo.length < 3) {
            this.showError("Le pseudo doit contenir au moins 3 caractères");
            return false;
        }

        if (!password || password.length < 6) {
            this.showError("Le mot de passe doit contenir au moins 6 caractères");
            return false;
        }

        if (this.isRegistering) {
            const confirmPassword = document.getElementById('confirm-password').value;
            if (password !== confirmPassword) {
                this.showError("Les mots de passe ne correspondent pas");
                return false;
            }
        }

        return true;
    }

    async register(pseudo, password) {
        console.log('Tentative d\'inscription...');
        this.socket.emit('register', { pseudo, password });

        return new Promise((resolve) => {
            this.socket.once('register-response', (response) => {
                console.log('Réponse inscription:', response);
                if (response.success) {
                    this.showSuccess("Compte créé avec succès!");
                    document.querySelector('[data-mode="login"]').click();
                    document.getElementById('pseudo').value = pseudo;
                    document.getElementById('password').value = '';
                    document.getElementById('confirm-password').value = '';
                } else {
                    this.showError(response.message || "Erreur lors de l'inscription");
                }
                resolve(response);
            });
        });
    }

    async login(pseudo, password) {
        if (this.isLocked) {
            this.showError("Compte bloqué. Veuillez attendre 30 secondes.", true);
            return;
        }

        this.socket.emit('login', { pseudo, password });

        this.socket.once('login-response', (response) => {
            if (response.success) {
                this.loginAttempts = 0;
                this.pseudo = pseudo;
                this.sessionKey = response.sessionKey;
                localStorage.setItem('sessionKey', this.sessionKey);
                localStorage.setItem('pseudo', this.pseudo);
                this.showSuccess("Connexion réussie!");
                this.initializeChat();
            } else {
                this.loginAttempts++;
                const remainingAttempts = this.maxAttempts - this.loginAttempts;
                
                document.getElementById('password').value = '';
                
                if (this.loginAttempts >= this.maxAttempts) {
                    this.lockLogin();
                } else {
                    this.showError(`Mot de passe incorrect. Il vous reste ${remainingAttempts} tentative${remainingAttempts > 1 ? 's' : ''}`);
                }
            }
        });
    }

    lockLogin() {
        this.isLocked = true;
        const inputs = document.querySelectorAll('.input-group input');
        const authBtn = document.getElementById('auth-btn');
        
        inputs.forEach(input => {
            input.disabled = true;
            input.style.opacity = '0.5';
            input.value = '';
        });
        
        authBtn.disabled = true;
        authBtn.style.opacity = '0.5';

        this.showError("Compte bloqué pour 30 secondes. Trop de tentatives incorrectes.", true);

        let timeLeft = 30;
        const countdownInterval = setInterval(() => {
            authBtn.querySelector('span').textContent = `BLOQUÉ (${timeLeft}s)_`;
            timeLeft--;

            if (timeLeft < 0) {
                clearInterval(countdownInterval);
                this.unlockLogin();
            }
        }, 1000);

        setTimeout(() => {
            this.unlockLogin();
            const errorMessage = document.querySelector('.error-message');
            if (errorMessage) {
                errorMessage.remove();
            }
        }, 30000);
    }

    unlockLogin() {
        this.isLocked = false;
        this.loginAttempts = 0;
        const inputs = document.querySelectorAll('.input-group input');
        const authBtn = document.getElementById('auth-btn');
        
        inputs.forEach(input => {
            input.disabled = false;
            input.style.opacity = '1';
            input.value = '';
        });
        authBtn.disabled = false;
        authBtn.style.opacity = '1';
        authBtn.querySelector('span').textContent = 'CONNEXION_';

        this.showSuccess("Compte débloqué");
    }

    async hashPassword(password) {
        const encoder = new TextEncoder();
        const data = encoder.encode(password);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    initializeChat() {
        document.getElementById('login-container').style.display = 'none';
        document.getElementById('chat-container').style.display = 'block';
        this.setupUIListeners();
        this.setupEmojiPicker();
        this.setupFileUpload();
    }

    setupSocketListeners() {
        this.socket.on('message', (data) => this.handleMessage(data));
        
        // Mise à jour du nombre d'utilisateurs
        this.socket.on('userCount', (count) => {
            const usersCount = document.getElementById('users-count');
            if (usersCount) {
                usersCount.innerHTML = `${count} <i class="fas fa-user"></i>`;
            }
        });
        
        this.socket.on('systemMessage', (message) => {
            this.displaySystemMessage(message);
        });

        this.socket.on('force-disconnect', (data) => {
            // Supprimer les données de session
            localStorage.removeItem('sessionKey');
            localStorage.removeItem('pseudo');
            
            // Créer une page de déconnexion
            document.body.innerHTML = `
                <div class="logout-container">
                    <div class="logout-box">
                        <i class="fas fa-check-circle"></i>
                        <h2>Session terminée</h2>
                        <p>${data.message}</p>
                        <button onclick="window.location.reload()">
                            Retour à la connexion
                        </button>
                    </div>
                </div>
            `;
        });
    }

    setupUIListeners() {
        const messageInput = document.getElementById('message-input');
        const sendBtn = document.getElementById('send-btn');

        // Gérer l'envoi de message
        sendBtn.addEventListener('click', () => this.sendMessage());
        
        // Gérer l'envoi avec Entrée
        messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });

        // Ajuster automatiquement la hauteur du champ de saisie
        messageInput.addEventListener('input', () => {
            messageInput.style.height = 'auto';
            messageInput.style.height = messageInput.scrollHeight + 'px';
        });

        // Gérer le défilement automatique
        const messagesContainer = document.getElementById('messages-container');
        messagesContainer.addEventListener('scroll', () => {
            const isScrolledToBottom = messagesContainer.scrollHeight - messagesContainer.clientHeight <= messagesContainer.scrollTop + 1;
            if (isScrolledToBottom) {
                this.isAutoScrollEnabled = true;
            } else {
                this.isAutoScrollEnabled = false;
            }
        });
    }

    encrypt(message) {
        const iv = CryptoJS.lib.WordArray.random(16);
        const encrypted = CryptoJS.AES.encrypt(message, this.key, {
            iv: iv
        });
        return {
            iv: iv.toString(),
            content: encrypted.toString()
        };
    }

    decrypt(encrypted, iv) {
        const decrypted = CryptoJS.AES.decrypt(encrypted, this.key, {
            iv: CryptoJS.enc.Hex.parse(iv)
        });
        return decrypted.toString(CryptoJS.enc.Utf8);
    }

    generateSessionKey() {
        return CryptoJS.lib.WordArray.random(256/8).toString();
    }

    hashPseudo(pseudo) {
        return CryptoJS.SHA256(pseudo + Date.now()).toString();
    }

    async joinChat() {
        const pseudoInput = document.getElementById('pseudo');
        const pseudo = pseudoInput.value.trim();
        
        if (this.connectionAttempts >= this.maxAttempts) {
            this.showError("Trop de tentatives. Veuillez réessayer plus tard.");
            setTimeout(() => {
                this.connectionAttempts = 0;
            }, 30000); // Reset après 30 secondes
            return;
        }

        if (!pseudo) {
            this.showError("Le pseudo est requis");
            return;
        }

        if (pseudo.length < 3) {
            this.showError("Le pseudo doit contenir au moins 3 caractères");
            return;
        }

        try {
            // Génération d'une clé de session unique
            this.sessionKey = this.generateSessionKey();
            const hashedPseudo = this.hashPseudo(pseudo);
            
            // Envoi des informations de connexion
            this.socket.emit('join-request', {
                pseudo: pseudo,
                hashedPseudo: hashedPseudo,
                timestamp: Date.now()
            });

            // Attente de la validation du serveur
            this.socket.once('join-response', (response) => {
                if (response.success) {
                    this.pseudo = pseudo;
                    this.connectionAttempts = 0;
                    document.getElementById('login-container').style.display = 'none';
                    document.getElementById('chat-container').style.display = 'block';
                    this.showSuccess("Connexion sécurisée établie");
                } else {
                    this.connectionAttempts++;
                    this.showError(response.message || "Erreur de connexion");
                }
            });

        } catch (error) {
            console.error('Erreur de connexion:', error);
            this.showError("Erreur lors de la connexion");
        }
    }

    showError(message, isLocked = false) {
        const errorDiv = document.createElement('div');
        errorDiv.className = 'error-message';
        errorDiv.textContent = message;
        
        const loginBox = document.querySelector('.login-box');
        const existingError = loginBox.querySelector('.error-message');
        if (existingError) {
            existingError.remove();
        }
        
        const authBtn = document.getElementById('auth-btn');
        loginBox.insertBefore(errorDiv, authBtn);
        
        if (!isLocked) {
            setTimeout(() => {
                errorDiv.remove();
            }, 3000);
        }
    }

    showSuccess(message) {
        const successDiv = document.createElement('div');
        successDiv.className = 'success-message';
        successDiv.textContent = message;
        
        document.getElementById('chat-container').insertBefore(
            successDiv, 
            document.getElementById('messages-container')
        );
        
        setTimeout(() => {
            successDiv.remove();
        }, 3000);
    }

    sendMessage() {
        const input = document.getElementById('message-input');
        const message = input.value.trim();
        
        if (message) {
            try {
                const encrypted = this.encrypt(message);
                this.socket.emit('message', {
                    pseudo: this.pseudo,
                    content: encrypted.content,
                    iv: encrypted.iv
                });
                input.value = '';
                input.style.height = 'auto';
            } catch (error) {
                console.error('Erreur lors de l\'envoi du message:', error);
                this.showError("Erreur lors de l'envoi du message");
            }
        }
    }

    handleMessage(data) {
        try {
            const decrypted = this.decrypt(data.content, data.iv);
            this.displayMessage(data.pseudo, decrypted, data.pseudo === this.pseudo);
        } catch (error) {
            console.error('Erreur lors du déchiffrement du message:', error);
            this.displaySystemMessage("Erreur lors de la réception d'un message");
        }
    }

    displayMessage(pseudo, message, isSent) {
        const messagesContainer = document.getElementById('messages-container');
        const messageElement = document.createElement('div');
        messageElement.className = `message ${isSent ? 'sent' : 'received'}`;
        
        const timestamp = new Date().toLocaleTimeString();
        messageElement.innerHTML = `
            <div class="username">${pseudo}</div>
            <div class="content">${message}</div>
            <div class="timestamp">${timestamp}</div>
        `;
        
        // Insérer au début du conteneur (en bas visuellement)
        messagesContainer.insertBefore(messageElement, messagesContainer.firstChild);
    }

    scrollToBottom() {
        const messagesContainer = document.getElementById('messages-container');
        const isScrolledToBottom = messagesContainer.scrollHeight - messagesContainer.clientHeight <= messagesContainer.scrollTop + 1;
        
        if (isScrolledToBottom) {
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
    }

    displayFileMessage(pseudo, fileData, isSent) {
        const messagesContainer = document.getElementById('messages-container');
        const messageElement = document.createElement('div');
        messageElement.className = `message ${isSent ? 'sent' : 'received'}`;
        
        const timestamp = new Date().toLocaleTimeString();
        const isImage = fileData.name.match(/\.(jpg|jpeg|png|gif)$/i);
        
        let content = '';
        if (isImage) {
            content = `<img src="${fileData.data}" alt="${fileData.name}" style="max-width: 200px; border-radius: 8px;">`;
        } else {
            content = `<a href="${fileData.data}" download="${fileData.name}" class="file-download">
                        <i class="fas fa-file"></i> ${fileData.name}
                      </a>`;
        }

        messageElement.innerHTML = `
            <div class="username">${pseudo}</div>
            <div class="content">${content}</div>
            <div class="timestamp">${timestamp}</div>
        `;
        
        messagesContainer.appendChild(messageElement);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    displaySystemMessage(message) {
        // Créer le message système fixe
        const fixedMessage = document.createElement('div');
        fixedMessage.className = 'system-message-fixed';
        fixedMessage.textContent = message;
        document.body.appendChild(fixedMessage);

        // Supprimer le message après 10 secondes
        setTimeout(() => {
            fixedMessage.addEventListener('animationend', (e) => {
                if (e.animationName === 'fadeOut') {
                    fixedMessage.remove();
                }
            });
        }, 10000);
    }

    setupEmojiPicker() {
        const emojiBtn = document.getElementById('emoji-btn');
        const messageInput = document.getElementById('message-input');
        
        // Liste d'emojis couramment utilisés
        const emojis = ['😊', '😂', '����', '👍', '😍', '🤔', '🔥', '😎', 
                       '😢', '😭', '😡', '🥳', '🤗', '👋', '✨', '💻', 
                       '🔒', '🛡️', '⚡', '🎮', '🌐', '📱', '💡', '🚀'];
        
        // Créer le picker d'emoji
        const picker = document.createElement('div');
        picker.className = 'emoji-picker';
        emojis.forEach(emoji => {
            const span = document.createElement('span');
            span.textContent = emoji;
            span.onclick = () => {
                messageInput.value += emoji;
                picker.classList.remove('active');
                messageInput.focus();
            };
            picker.appendChild(span);
        });
        
        // Ajouter le picker au conteneur des actions
        document.querySelector('.input-actions').appendChild(picker);
        
        // Gestionnaire de clic pour le bouton emoji
        emojiBtn.onclick = (e) => {
            e.stopPropagation();
            picker.classList.toggle('active');
        };

        // Fermer le picker quand on clique ailleurs
        document.addEventListener('click', () => {
            picker.classList.remove('active');
        });

        // Empêcher la fermeture lors du clic sur le picker lui-même
        picker.addEventListener('click', (e) => {
            e.stopPropagation();
        });
    }

    setupFileUpload() {
        const fileBtn = document.getElementById('file-btn');
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.style.display = 'none';
        document.body.appendChild(fileInput);

        fileBtn.onclick = () => fileInput.click();

        fileInput.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            // Limite de taille (5MB)
            if (file.size > 5 * 1024 * 1024) {
                alert('Le fichier est trop volumineux (maximum 5MB)');
                return;
            }

            try {
                const base64 = await this.fileToBase64(file);
                const encrypted = this.encrypt(JSON.stringify({
                    type: 'file',
                    name: file.name,
                    data: base64
                }));

                this.socket.emit('message', {
                    pseudo: this.pseudo,
                    content: encrypted.content,
                    iv: encrypted.iv
                });
            } catch (err) {
                console.error('Erreur lors du téléchargement:', err);
                alert('Erreur lors du téléchargement du fichier');
            }
        };
    }

    fileToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = () => resolve(reader.result);
            reader.onerror = error => reject(error);
        });
    }

    checkExistingSession() {
        const sessionKey = localStorage.getItem('sessionKey');
        const pseudo = localStorage.getItem('pseudo');
        
        if (sessionKey && pseudo) {
            this.socket.emit('verify-session', { sessionKey, pseudo });
            
            this.socket.once('session-response', (response) => {
                if (response.success) {
                    this.pseudo = pseudo;
                    this.sessionKey = sessionKey;
                    this.initializeChat();
                } else {
                    localStorage.removeItem('sessionKey');
                    localStorage.removeItem('pseudo');
                }
            });
        }
    }

    showAdminPasswordDialog() {
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.className = 'admin-overlay';
            document.body.appendChild(overlay);

            const dialog = document.createElement('div');
            dialog.className = 'admin-password-dialog';
            dialog.innerHTML = `
                <h3>Authentification Administrateur</h3>
                <div class="error-container"></div>
                <div class="input-group">
                    <input type="password" id="admin-password" 
                        placeholder="Mot de passe administrateur" 
                        autocomplete="off">
                </div>
                <button id="admin-submit">
                    <i class="fas fa-lock"></i>
                    VALIDER
                </button>
                <button id="admin-cancel" class="cancel-btn">
                    <i class="fas fa-times"></i>
                    ANNULER
                </button>
            `;

            document.body.appendChild(dialog);

            requestAnimationFrame(() => {
                overlay.classList.add('active');
                dialog.classList.add('active');
            });

            const showDialogError = (message) => {
                const errorContainer = dialog.querySelector('.error-container');
                errorContainer.innerHTML = `
                    <div class="admin-error">
                        <i class="fas fa-exclamation-triangle"></i>
                        <span>${message}</span>
                    </div>
                `;
            };

            const adminPassword = dialog.querySelector('#admin-password');
            const submitBtn = dialog.querySelector('#admin-submit');
            const cancelBtn = dialog.querySelector('#admin-cancel');

            const closeDialog = (success) => {
                dialog.classList.remove('active');
                overlay.classList.remove('active');
                setTimeout(() => {
                    dialog.remove();
                    overlay.remove();
                }, 300);
                resolve(success);
            };

            const handleSubmit = () => {
                if (adminPassword.value === 'Fujivick@@221') {
                    closeDialog(true);
                } else {
                    showDialogError("Mot de passe administrateur incorrect");
                    adminPassword.value = '';
                    adminPassword.focus();
                }
            };

            submitBtn.addEventListener('click', handleSubmit);
            adminPassword.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') handleSubmit();
            });

            cancelBtn.addEventListener('click', () => {
                closeDialog(false);
                document.querySelector('[data-mode="login"]').click();
            });

            adminPassword.focus();

            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    closeDialog(false);
                    document.querySelector('[data-mode="login"]').click();
                }
            });
        });
    }
}

// Initialisation du chat
document.addEventListener('DOMContentLoaded', () => {
    new SecureChat();
}); 