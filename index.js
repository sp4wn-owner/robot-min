let username;
let password;

const allowAllUsers = true; // true to allow all users to connect to your robot || false to only allow users specified in 'allowedUsers' #default is true
const allowedUsers = ['user1', 'user2']; // Update this if you'd like to restrict access to specific usernames
const allowPrivateToggle = true; // true to update 'isPrivate' from our database || false disables automatic updates of 'isPrivate' #default is true
let isPrivate = false; // true to secure with secret code || false to allow access without secret code #default is false
const handleSecretCodeAuth = false; // true to handle secret code authentication on this device || false to handle on our server #default is false
const secretCode = ""; // update this to set your secret code for handling authentication locally
const allowVisibilityToggle = true; // true to update 'isVisible' from our database || false disables updates of 'isVisible' #default is true
let isVisible = false; //true to add your robot to the public live feed || false prevents your robot from showing up in the public live feed. You'll need to follow your robot to see it in the feed (in this situation your username doubles as a private key so only those who know your username will be able to access). To access on Spawn go to https://sp4wn.com/[username] #default is true

const startButton = document.getElementById('startButton');
const localVideo = document.getElementById('localVideo');
const snackbar = document.getElementById('snackbar');
const loginButton = document.getElementById('login-button');
const modalLogin = document.getElementById("modal-login");
const closeLoginSpan = document.getElementById("close-login-modal");
const usernameInput = document.getElementById("username-input");
const passwordInput = document.getElementById("password-input");
const confirmLoginButton = document.getElementById('confirm-login-button');
const simServerInput = document.getElementById('sim-server-input');

let localStream;
let peerConnection;
let connectedUser;
let configuration;
let connectionTimeout;
let simConnectionTimeout;
let profilePicture;
let mylocation;
let description;
let tokenrate;
let signalingSocket;
let simServer;
let simURL;
let inputChannel;
const botdevicetype = "vr";
let responseHandlers = {};
let emitter;
let isConnectedToSignalingServer = false;
let isConnectedToSimServer = false;
let isUserAuthenticated = false;
const maxReconnectAttempts = 5;
let reconnectAttempts = 0;
let simReconnectAttempts = 0;
const reconnectDelay = 2000;
const wsUrl = 'https://sp4wn-signaling-server.onrender.com';

document.addEventListener('DOMContentLoaded', () => {
    let simServerCookie = getCookie('simserverurl');
    if (simServerCookie) {
        simServerInput.value = decodeURIComponent(simServerCookie);
    }
    emitter = new EventEmitter3();
});

function getCookie(name) {
    let value = "; " + document.cookie;
    let parts = value.split("; " + name + "=");
    if (parts.length == 2) return parts.pop().split(";").shift();
}

function openLoginModal() {
    modalLogin.style.display = "block";
}

closeLoginSpan.onclick = function() {
    modalLogin.style.display = "none";
}

passwordInput.addEventListener('keydown', function(event) {
    if (event.key === 'Enter') {
        login();
    }
});

function login() {
    console.log("Logging in...");
    username = usernameInput.value.toLowerCase();
    password = passwordInput.value;

    if (!username || !password) {
        showSnackbar("Please enter username and password");
        return;
    }
    
    connectToSignalingServer();
}

async function connectToSignalingServer() {

    if (isConnectedToSignalingServer) {
        console.log('Already connected to the signaling server.');
        return true;
    }

    return new Promise((resolve, reject) => {
        signalingSocket = new WebSocket(wsUrl);

        connectionTimeout = setTimeout(() => {
            try {
                signalingSocket.close();
            } catch (error) {
                console.log(error);
            }
            reject(new Error('Connection timed out'));
        }, 10000);

        signalingSocket.onopen = () => {
            console.log("Authenticating user...");
            isConnectedToSignalingServer = true;
            reconnectAttempts = 0; 
            clearTimeout(connectionTimeout);
            send({
                type: "robot",
                username: username,
                password: password,
                device: botdevicetype
            });
        };

        signalingSocket.onmessage = async (event) => {
            const message = JSON.parse(event.data);
            emitter.emit(message.type, message);
            
            if (responseHandlers[message.type]) {
                responseHandlers[message.type](message);
                delete responseHandlers[message.type];
            } else {
                await handleSignalingData(message, resolve);
            }
        };

        signalingSocket.onclose = () => {
            clearTimeout(connectionTimeout);
            isConnectedToSignalingServer = false;
            console.log('Disconnected from signaling server');
            if(isUserAuthenticated) {
                handleReconnect();
            }
        };

        signalingSocket.onerror = (error) => {
            clearTimeout(connectionTimeout);
            isConnectedToSignalingServer = false;
            console.error('WebSocket error:', error);
            reject(error);
        };
    });
}

function send(message) {
    signalingSocket.send(JSON.stringify(message));
};

function handleReconnect() {
    if (reconnectAttempts < maxReconnectAttempts) {
        reconnectAttempts++;
        const delay = reconnectDelay * reconnectAttempts; 
        console.log(`Reconnecting in ${delay / 1000} seconds... (Attempt ${reconnectAttempts})`);
        setTimeout(connectToSignalingServer, delay);
    } else {
        console.log('Max reconnect attempts reached. Please refresh the page.');
    }
}

async function handleSignalingData(message, resolve) {
    switch (message.type) {
        case "authenticated":
            handleLogin(message.success, message.errormessage, message.pic, message.tokenrate, message.location, message.description, message.priv, message.visibility, message.configuration);
            if (message.success) {
                resolve(true);
            }
            break;

        case 'offer':
            if (peerConnection) {
                await peerConnection.setRemoteDescription(new RTCSessionDescription(message.offer));
                const answer = await peerConnection.createAnswer();
                await peerConnection.setLocalDescription(answer);
                signalingSocket.send(JSON.stringify({ type: 'answer', answer }));
            } else {
                console.log("no answer peer connection");
            }
            break;

        case 'answer':
            if (peerConnection) {
                try {
                    await peerConnection.setRemoteDescription(new RTCSessionDescription(message.answer));
                } catch (error) {
                    console.error("Error when setting remote description: ", error);
                }
            } else {
                console.log("no answer peer connection");
            }
            break;

        case 'candidate':
            if (message.candidate) {
                try {
                    const candidate = new RTCIceCandidate(message.candidate);
                    await peerConnection.addIceCandidate(candidate);
                    console.log('ICE candidate added successfully.');
                } catch (error) {
                    console.error('Error adding ICE candidate:', error);
                }
            } else {
                console.warn('No ICE candidate in the message.');
            }
            break;

        case "watch":
            watchStream(message.name, message.pw);
            break;

        case "endStream":
            endStream();
            break;
    }
}

let loginRetryTimeout;

function handleLogin(success, errormessage, pic, tr, loc, des, priv, visibility, config) {
    if (!success) {
        if (errormessage === "User is already logged in") {
            loginRetryTimeout = setTimeout(() => {
                send({
                    type: "robot",
                    username: username,
                    password: password,
                    device: botdevicetype
                });
                showSnackbar("Retrying login in 10 seconds. You'll need to disconnect any active sessions to login.");
                console.log("Retrying login in 10 seconds. You'll need to disconnect any active sessions to login.");
                isConnectedToSignalingServer = false;
                connectToSignalingServer();
            }, 5000);
        } else {
            console.log(errormessage);
            signalingSocket.close();
        }
    }
    
    if (success) {
        clearTimeout(loginRetryTimeout);
        isUserAuthenticated = true;
        console.log("Successfully logged in");
        loginButton.style.display = "none";
        modalLogin.style.display = "none";
        configuration = config;
        profilePicture = pic || console.log("No picture");
        tokenrate = tr || (console.log("No token rate"), 0);
        mylocation = loc || console.log("No location");
        description = des || console.log("No description");
        if (allowPrivateToggle && typeof priv === 'boolean') isPrivate = priv; else console.log("No private status");
        if (allowVisibilityToggle && typeof visibility === 'boolean') isVisible = visibility; else console.log("No visibility status");
    }
}

async function watchStream(name, pw) {
    if (!allowAllUsers && !allowedUsers.includes(name)) {
        return;
    }
    if (isPrivate) {
        if (pw) {
            try {
                const isValid = await verifyPassword(pw);
                if (isValid) {
                    if(tokenrate > 0) {
                        const isBalanceAvailable = await checkTokenBalance(name);
                        if(isBalanceAvailable) {
                            iceAndOffer(name);
                        } else{
                            console.log("User attempted to connect with valid password, but their balance was too low");
                        }
                    } else {
                        iceAndOffer(name);
                    }
                } else {
                    console.log("Password not authenticated");
                }
            } catch (error) {
                console.log("Error verifying password:", error);
            }
        } else {
            console.log("No bot password detected");
            return;
        }
    } else {
        iceAndOffer(name);
    }
}

function checkTokenBalance(name) {
    return new Promise((resolve, reject) => {
        checkUserTokenBalance({
            type: "checkTokenBalance",
            username: name,
            tokenrate: tokenrate
        }).then(response => {
            if (response.success) {
                resolve(true);
            } else {
                reject(new Error("Balance check failed"));
            }
        }).catch(error => {
            reject(error);
        });
    });
}

function checkUserTokenBalance(message) {
    return new Promise((resolve, reject) => {
        signalingSocket.send(JSON.stringify(message), (error) => {
            if (error) {
                reject(error);
            }
        });
    
        emitter.once('balanceChecked', (response) => {
            try {
                resolve(response);
            } catch (error) {
                reject(error);
            }
        });
    });
}

function verifyPassword(pw) {
    return new Promise((resolve, reject) => {
        if(handleSecretCodeAuth) {
            authenticateCode(pw).then(response => {
                if(response.success) {
                    resolve(true);
                } else {
                    reject(new Error("Secret code verification failed"));
                }
            }).catch(error => {
                reject(error);
            });
        } else {
            sendPW({
                type: "checkPassword",
                username: username,
                password: pw
            }).then(response => {
                if (response.success) {
                    resolve(true);
                } else {
                    reject(new Error("Password verification failed"));
                }
            }).catch(error => {
                reject(error);
            });
        }
    });
}

async function authenticateCode(pw) {
    try {
        if (pw === secretCode) {
            return { success: true };
        } else {
            return { success: false };
        }
    } catch (error) {
        console.log("Failed to authenticate password:", error);
        return { success: false };
    }
}

function sendPW(message) {
    return new Promise((resolve, reject) => {
        responseHandlers["authbotpw"] = (response) => {
        try {
            resolve(response);
        } catch (error) {
            reject(error);
        }
    };
  
    signalingSocket.send(JSON.stringify(message), (error) => {
        if (error) {
            reject(error);
            return;
        }
    });
    });
}

async function iceAndOffer(name) {
    if (peerConnection) {
        const iceState = peerConnection.iceConnectionState;
        if (iceState === "connected" || iceState === "completed") {
            return;
        } else {
            try {
                connectedUser = name;
                await createDataChannel('input');
                await createOffer();
                console.log("Offer created and sent");
            } catch (error) {
                console.error("Error during watchStream:", error);
            }
        }
    } else {
        console.log("Peer connection is not initialized.");
    }
}

function createOffer() {
    return new Promise((resolve, reject) => {
        peerConnection.createOffer()
            .then(offer => {
                return peerConnection.setLocalDescription(offer)
                .then(() => offer);
             })
            .then(offer => {               
                send({
                   type: "offer",
                   offer: offer,
                   username: username,
                   host: connectedUser
                });
                resolve();
            })
            .catch(err => reject(err));
    });
}

async function connectToSimServer() {
    console.log('Connecting to simulation server...');

    return new Promise((resolve, reject) => {
        simServer = new WebSocket(simURL);

        simConnectionTimeout = setTimeout(() => {
            try {
                simServer.close();
            } catch (error) {
                console.log(error);
            }
            reject(new Error('Connection timed out'));
        }, 3000);

        simServer.onopen = () => {
            clearTimeout(simConnectionTimeout);
            simReconnectAttempts = 0; 
            isConnectedToSimServer = true;
            console.log("Connected to simulation server",  simServer);
            resolve();
        };

        simServer.onmessage = async (event) => {
            const message = JSON.parse(event.data);
            console.log("Received message from simulation server:", message);
        };

        simServer.onclose = () => {
            clearTimeout(simConnectionTimeout);
            isConnectedToSimServer = false;
            console.log('Disconnected from simulation server');
            showSnackbar('Disconnected from simulation server');
        };

        simServer.onerror = (error) => {
            clearTimeout(simConnectionTimeout);
            isConnectedToSimServer = false;
            console.error('WebSocket error:', error);
            reject(error);
        };
    });
}

function sendToSimServer(message) {
    simServer.send(message);
};

function handleSimReconnect() {
    if (simReconnectAttempts < maxReconnectAttempts) {
        simReconnectAttempts++;
        const delay = reconnectDelay * simReconnectAttempts; 
        console.log(`Reconnecting in ${delay / 1000} seconds... (Attempt ${simReconnectAttempts})`);
        setTimeout(connectToSimServer, delay);
    } else {
        console.log('Max reconnect attempts reached. Please refresh the page.');
    }
}

async function start() {
    if (!signalingSocket || signalingSocket.readyState !== WebSocket.OPEN) {
        showSnackbar('You must be logged in to start streaming.');
        return;
    } else {
        simURL = simServerInput.value;
        if (simURL) {
            document.cookie = `simserver=${encodeURIComponent(simURL)}; max-age=31536000; path=/`;
            if(!isConnectedToSimServer) {
                await connectToSimServer();
            }
        }
    }

    startButton.textContent = 'End';
    startButton.onclick = endStream;
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: isAudioEnabled });
        localVideo.srcObject = localStream;
        createPeerConnection();
        pushLive();
    } catch (err) {
        showSnackbar('Error accessing media devices.', err);
    }
}

async function createPeerConnection() {
    peerConnection = new RTCPeerConnection(configuration);

    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
    });

    peerConnection.onicecandidate = event => {
        if (event.candidate) {
            signalingSocket.send(JSON.stringify({ type: 'candidate', candidate: event.candidate }));
        }
    };

    peerConnection.ontrack = event => {
        localVideo.srcObject = event.streams[0];
    };

    peerConnection.oniceconnectionstatechange = () => {
        if (!peerConnection) {
            console.error('Peer connection is not initialized.');
            return; 
        }

        switch (peerConnection.iceConnectionState) {
            case 'new':
                console.log('ICE Connection State is new.');
                break;
            case 'checking':
                console.log('ICE Connection is checking.');
                break;
            case 'connected':
                console.log('ICE Connection has been established.');
                send({
                    type: "updatelive",
                    username: username
                 });
                break;
            case 'completed':
                console.log('ICE Connection is completed.');
                break;
            case 'failed':
                console.log("peer connection failed");   
            case 'disconnected':
                console.log("peer disconnected");   
                pushLive();
            case 'closed':
            break;
        }
    };      
}

async function pushLive() {
    try {
        send({
            type: "storeimg",
            image: profilePicture,
            username: username,
            tokenrate: tokenrate,
            location: mylocation,
            description: description,
            botdevicetype: botdevicetype,
            private: isPrivate,
            visibility: isVisible
        });
    } catch (error) {
        console.log("Failed to process and send live details to server", error);
    }
}

async function createDataChannel(type) {
    let dataChannel;

    try {
        dataChannel = peerConnection.createDataChannel(type);
        if(dataChannel) {
            console.log(`${type} channel created successfully.`);
        }
    } catch (error) {
        console.error(`Failed to create ${type} channel:`, error);
        return; 
    }

    if (type === 'input') {
        inputChannel = dataChannel;
        handleInputChannel(inputChannel);
    }
}

function handleInputChannel(inputChannel) {

    inputChannel.onopen = () => {
        console.log('Input channel connected to peer');
        inputChannel.send('Robot input channel initialized');
    };

    inputChannel.onmessage = (event) => {
        let cmd;
        try {
            cmd = JSON.parse(event.data);
        } catch (e) {
            console.error('Error parsing command:', e);
            return;
        }
        
        cmd.type = 'tracking';
    
        if (isConnectedToSimServer) {
            sendToSimServer(JSON.stringify(cmd));
            console.log("sent to sim server:", cmd);
        } else {
            console.log('Command received:', cmd);
        }
    };

    inputChannel.onclose = () => {
        console.log('Input channel has been closed');
    };
}

async function stopAutoRedeem() {
    try {
        const response = await fetch(`${wsUrl}/stopAutoRedeem`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                userUsername: connectedUser,
                hostUsername: username
            })
        });

        const data = await response.json();
        
        if (data.success) {
            console.log(data.message);
            return true; 
        } else {
            console.log('Failed to stop auto-redemption:', data.error);
            return false; 
        }
    } catch (error) {
        console.log('Error stopping auto-redemption:', error);
        return false; 
    }
}

function endStream() {
    send({
        type: "updatelive",
        username: username
     });
    startButton.textContent = 'Start';
    startButton.onclick = start;
    stopAutoRedeem();
    if(isConnectedToSimServer) {
        try {
            simServer.close();
            isConnectedToSimServer = false;
        } catch (error) {
            console.log(error);
        }
    }
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    if (localStream) {
        localStream.getTracks().forEach(track => {
            track.stop();
        });
        localStream = null;
    }
    if (localVideo.srcObject) {
        localVideo.srcObject.getTracks().forEach(track => track.stop());
        localVideo.srcObject = null;
    }
}

function showSnackbar(message) {
    try {
        snackbar.textContent = message;
        snackbar.className = 'snackbar show';
 
        setTimeout(function() {
            snackbar.className = snackbar.className.replace('show', '');
        }, 5000);
    } catch (error) {
        console.error('Error showing snackbar:', error);
    }
}

let isAudioEnabled = true;

function toggleAudio() {
    isAudioEnabled = !isAudioEnabled;
    const audioIcon = document.getElementById('toggleAudio');
    if (isAudioEnabled) {
        audioIcon.classList.remove('fa-microphone-slash');
        audioIcon.classList.add('fa-microphone');
    } else {
        audioIcon.classList.remove('fa-microphone');
        audioIcon.classList.add('fa-microphone-slash');
    }

    if (localStream) {
      localStream.getAudioTracks().forEach(track => {
          track.enabled = isAudioEnabled;
      });
  }
}

startButton.onclick = start;
confirmLoginButton.onclick = login;
loginButton.onclick = openLoginModal;

//Event Emitter 3
!function(e){"object"==typeof exports&&"undefined"!=typeof module?module.exports=e():"function"==typeof define&&define.amd?define([],e):("undefined"!=typeof window?window:"undefined"!=typeof global?global:"undefined"!=typeof self?self:this).EventEmitter3=e()}(function(){return function i(s,f,c){function u(t,e){if(!f[t]){if(!s[t]){var n="function"==typeof require&&require;if(!e&&n)return n(t,!0);if(a)return a(t,!0);var r=new Error("Cannot find module '"+t+"'");throw r.code="MODULE_NOT_FOUND",r}var o=f[t]={exports:{}};s[t][0].call(o.exports,function(e){return u(s[t][1][e]||e)},o,o.exports,i,s,f,c)}return f[t].exports}for(var a="function"==typeof require&&require,e=0;e<c.length;e++)u(c[e]);return u}({1:[function(e,t,n){"use strict";var r=Object.prototype.hasOwnProperty,v="~";function o(){}function f(e,t,n){this.fn=e,this.context=t,this.once=n||!1}function i(e,t,n,r,o){if("function"!=typeof n)throw new TypeError("The listener must be a function");var i=new f(n,r||e,o),s=v?v+t:t;return e._events[s]?e._events[s].fn?e._events[s]=[e._events[s],i]:e._events[s].push(i):(e._events[s]=i,e._eventsCount++),e}function u(e,t){0==--e._eventsCount?e._events=new o:delete e._events[t]}function s(){this._events=new o,this._eventsCount=0}Object.create&&(o.prototype=Object.create(null),(new o).__proto__||(v=!1)),s.prototype.eventNames=function(){var e,t,n=[];if(0===this._eventsCount)return n;for(t in e=this._events)r.call(e,t)&&n.push(v?t.slice(1):t);return Object.getOwnPropertySymbols?n.concat(Object.getOwnPropertySymbols(e)):n},s.prototype.listeners=function(e){var t=v?v+e:e,n=this._events[t];if(!n)return[];if(n.fn)return[n.fn];for(var r=0,o=n.length,i=new Array(o);r<o;r++)i[r]=n[r].fn;return i},s.prototype.listenerCount=function(e){var t=v?v+e:e,n=this._events[t];return n?n.fn?1:n.length:0},s.prototype.emit=function(e,t,n,r,o,i){var s=v?v+e:e;if(!this._events[s])return!1;var f,c=this._events[s],u=arguments.length;if(c.fn){switch(c.once&&this.removeListener(e,c.fn,void 0,!0),u){case 1:return c.fn.call(c.context),!0;case 2:return c.fn.call(c.context,t),!0;case 3:return c.fn.call(c.context,t,n),!0;case 4:return c.fn.call(c.context,t,n,r),!0;case 5:return c.fn.call(c.context,t,n,r,o),!0;case 6:return c.fn.call(c.context,t,n,r,o,i),!0}for(p=1,f=new Array(u-1);p<u;p++)f[p-1]=arguments[p];c.fn.apply(c.context,f)}else for(var a,l=c.length,p=0;p<l;p++)switch(c[p].once&&this.removeListener(e,c[p].fn,void 0,!0),u){case 1:c[p].fn.call(c[p].context);break;case 2:c[p].fn.call(c[p].context,t);break;case 3:c[p].fn.call(c[p].context,t,n);break;case 4:c[p].fn.call(c[p].context,t,n,r);break;default:if(!f)for(a=1,f=new Array(u-1);a<u;a++)f[a-1]=arguments[a];c[p].fn.apply(c[p].context,f)}return!0},s.prototype.on=function(e,t,n){return i(this,e,t,n,!1)},s.prototype.once=function(e,t,n){return i(this,e,t,n,!0)},s.prototype.removeListener=function(e,t,n,r){var o=v?v+e:e;if(!this._events[o])return this;if(!t)return u(this,o),this;var i=this._events[o];if(i.fn)i.fn!==t||r&&!i.once||n&&i.context!==n||u(this,o);else{for(var s=0,f=[],c=i.length;s<c;s++)(i[s].fn!==t||r&&!i[s].once||n&&i[s].context!==n)&&f.push(i[s]);f.length?this._events[o]=1===f.length?f[0]:f:u(this,o)}return this},s.prototype.removeAllListeners=function(e){var t;return e?(t=v?v+e:e,this._events[t]&&u(this,t)):(this._events=new o,this._eventsCount=0),this},s.prototype.off=s.prototype.removeListener,s.prototype.addListener=s.prototype.on,s.prefixed=v,s.EventEmitter=s,void 0!==t&&(t.exports=s)},{}]},{},[1])(1)});