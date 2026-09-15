// ==========================================
// PRODUCTION LOGGER HARDENING
// ==========================================
// Disable standard console output in production to prevent memory leaks and data exposure
if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
    const noOp = function() {};
    console.log = noOp;
    console.info = noOp;
    console.debug = noOp;
    // We intentionally leave console.warn and console.error active for diagnostic tracking
}

// --- FIREBASE CONFIGURATION ---
const firebaseConfig = {
    apiKey: "AIzaSyD-Vr6HYr4dMibDxRrynQ4EdiXNAp0MCmE",
    authDomain: "superroom-lobby.firebaseapp.com",
    projectId: "superroom-lobby",
    storageBucket: "superroom-lobby.firebasestorage.app",
    messagingSenderId: "334732691291",
    appId: "1:334732691291:web:6e1e01827ac7c6baf6fc7e"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.database();
// --- AUTHENTICATION LOGIC ---
const auth = firebase.auth();
const provider = new firebase.auth.GoogleAuthProvider();

let currentActiveChatFriendId = null;
let activeCallData = null;

auth.onAuthStateChanged(user => {
    // Dismiss production loader
    const loader = document.getElementById('globalLoader');
    if (loader) {
        loader.style.opacity = '0';
        setTimeout(() => loader.style.display = 'none', 500);
    }
    if (user) {
        // 1. Check if user is BANNED before letting them in
        db.ref(`banned_users/${user.uid}`).once('value', snap => {
            if (snap.exists()) {
                auth.signOut();
                alert("ACCESS DENIED: Your account has been permanently banned by the Administrator.");
                document.getElementById('authSection').style.display = 'block';
                document.getElementById('roomControls').style.display = 'none';
                return;
            }
            
            // 2. Not banned, proceed to inject Admin button if applicable
            checkAdminStatus(user.uid);
            
            // 3. Setup user details
            myDisplayName = user.displayName;
            document.getElementById('authSection').style.display = 'none';
            document.getElementById('roomControls').style.display = 'flex';
            document.getElementById('userInfo').innerHTML = `<img src="${user.photoURL}" style="width: 35px; height: 35px; border-radius: 50%; vertical-align: middle; margin-right: 10px; border: 2px solid var(--accent);"> ${window.DOMPurify ? DOMPurify.sanitize(user.displayName, {ALLOWED_TAGS:[]}) : user.displayName.replace(/[<>]/g, '')}`;

            // Store / Update user profile in Firebase database
            const userRef = db.ref('users/' + user.uid);
            userRef.set({
                uid: user.uid,
                displayName: user.displayName,
                photoURL: user.photoURL,
                status: 'online'
            });
            userRef.onDisconnect().update({ status: 'offline' });

            // Listen for incoming calls & friends list updates
            listenForIncomingCalls(user.uid);
            initSocialEngine(user.uid);
        }); // Close the banned_users listener
        
    } else {
        myDisplayName = "Guest";
        document.getElementById('authSection').style.display = 'flex';
        document.getElementById('roomControls').style.display = 'none';
        document.getElementById('setupPanel').style.display = 'none';
    }
});


function cleanupFirebaseListeners() {
    const uid = auth.currentUser ? auth.currentUser.uid : null;
    if (uid) {
        db.ref(`calls/${uid}`).off();
        db.ref(`following/${uid}`).off();
        db.ref(`message_requests/${uid}`).off();
    }
    if (typeof currentDirectChatRef !== 'undefined' && currentDirectChatRef) currentDirectChatRef.off();
}

function signInWithGoogle() {
    // Try popup sign‑in first (requires user interaction). If blocked, fall back to redirect.
    auth.signInWithPopup(provider).catch(err => {
        console.error("Login failed (popup):", err);
        // Fallback for popup‑blocked or other issues
        if (err.code === 'auth/popup-blocked' || err.code === 'auth/operation-not-allowed' || err.code === 'auth/popup-closed-by-user') {
            auth.signInWithRedirect(provider).catch(err2 => console.error("Login failed (redirect):", err2));
        }
    });
}
// Expose sign‑in/out functions to the global scope for inline onclick handlers
window.signInWithGoogle = signInWithGoogle;
window.signOut = signOut;

function signOut() {
    auth.signOut();
}

// ==========================================
// 0. LOBBY BACKGROUND PARTICLES (RED PETALS)
// ==========================================
function createPetals() {
    // PRIORITY 22: Disable DOM particle injection if the user prefers reduced motion
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    
    const container = document.getElementById('particleContainer');
    for (let i = 0; i < 30; i++) {
        let p = document.createElement('div');
        p.className = 'petal';
        p.style.left = Math.random() * 100 + 'vw';
        p.style.animationDelay = (Math.random() * 15) + 's';
        p.style.animationDuration = (10 + Math.random() * 15) + 's';
        
        const size = (8 + Math.random() * 12) + 'px';
        p.style.width = size;
        p.style.height = size;
        
        container.appendChild(p);
    }
}
window.addEventListener('load', createPetals);

// ==========================================
// SECURE DIAGNOSTIC ISSUE TRACKER
// ==========================================
let errorBuffer = [];
let diagnosticClickCount = 0;
let diagnosticTimeout = null;

// Catch all errors securely in the background
window.addEventListener('error', function(e) {
    errorBuffer.push(`[${new Date().toLocaleTimeString()}] ${e.message} at ${e.filename}:${e.lineno}`);
    if (errorBuffer.length > 50) errorBuffer.shift(); 
});
window.addEventListener('unhandledrejection', function(e) {
    errorBuffer.push(`[${new Date().toLocaleTimeString()}] Unhandled Promise Rejection: ${e.reason}`);
    if (errorBuffer.length > 50) errorBuffer.shift();
});

// Hidden diagnostic trigger for developer
function checkDiagnosticTrigger() {
    diagnosticClickCount++;
    clearTimeout(diagnosticTimeout);
    
    if (diagnosticClickCount >= 5) {
        diagnosticClickCount = 0;
        if (confirm("DIAGNOSTIC MODE\nGenerate an error report for developers?")) { // Developer convenience utility
            let logText = "=== SUPERROOM PRO DIAGNOSTIC LOG ===\n\n";
            if (errorBuffer.length === 0) logText += "No frontend errors detected.\n";
            else logText += errorBuffer.join("\n");
            
            logText += `\n\nSession Details:\nHost ID: ${currentRoomHostId || 'N/A'}\nUser Agent: ${navigator.userAgent}\n`;
            
            // Download as local text file. 100% secure, never transmitted to a server.
            const blob = new Blob([logText], {type: "text/plain"});
            const u = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = u;
            a.download = `Diagnostic-Log-${Date.now()}.txt`;
            a.click();
            URL.revokeObjectURL(u);
            alert("Diagnostic log downloaded securely.");
        } else {
            alert("Unauthorized.");
        }
    } else {
        diagnosticTimeout = setTimeout(() => { diagnosticClickCount = 0; }, 2000);
    }
}




// 0. UI, HOTKEYS, & 3D THEMES
// ==========================================
let topBarHidden = false;

function toggleTopBar() {
    const controls = document.querySelector('.top-controls');
    const icon = document.querySelector('#topBarToggleBtn i');
    
    if (!topBarHidden) {
        controls.style.display = 'none';
        icon.className = 'fas fa-chevron-down';
        topBarHidden = true;
    } else {
        controls.style.display = 'flex';
        icon.className = 'fas fa-chevron-up';
        topBarHidden = false;
    }
}

function changeTheme(v) { 
    document.body.className = v; 
    
    const roseCenter = document.getElementById('roseCenterElement');
    const petals = document.getElementById('particleContainer');
    
    // Hide all 3D layers first
    document.querySelectorAll('.theme-layer').forEach(layer => layer.style.display = 'none');
    
    if(v === 'theme-default') {
        document.documentElement.style.setProperty('--accent', '#e60000'); 
        document.documentElement.style.setProperty('--btn-bg', '#e60000'); 
        document.documentElement.style.setProperty('--btn-text', '#ffffff'); 
        roseCenter.style.display = 'block';
        petals.style.display = 'block';
    } else {
        roseCenter.style.display = 'none';
        petals.style.display = 'none';
        
        if(v === 'theme-matrix') {
            document.documentElement.style.setProperty('--accent', '#00ff00');
            document.documentElement.style.setProperty('--btn-text', '#000000'); 
            document.querySelector('.layer-matrix').style.display = 'block';
        } else if(v === 'theme-synthwave') {
            document.documentElement.style.setProperty('--accent', '#00ffff');
            document.documentElement.style.setProperty('--btn-text', '#000000'); 
            document.querySelector('.layer-synth').style.display = 'block';
        } else if(v === 'theme-space') {
            document.documentElement.style.setProperty('--accent', '#ffffff');
            document.documentElement.style.setProperty('--btn-text', '#000000'); 
            document.querySelector('.layer-space').style.display = 'block';
        }
    }
}

function toggleSetupPanel() { 
    const p = document.getElementById('setupPanel'); 
    const pubRooms = document.getElementById('publicRoomsContainer');
    if (p.style.display === 'block') {
        p.style.display = 'none'; 
        if (pubRooms) pubRooms.style.display = 'block';
    } else {
        p.style.display = 'block'; 
        if (pubRooms) pubRooms.style.display = 'none';
        setTimeout(() => p.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    }
}

function switchView(v) { 
    const lobby = document.getElementById('lobbyView');
    const room = document.getElementById('roomView');
    const social = document.getElementById('socialHubView');

    if (lobby) { lobby.className = 'view'; lobby.style.cssText = ''; }
    if (room) { room.className = 'view'; room.style.cssText = ''; }
    if (social) { social.className = 'view'; social.style.display = 'none'; }

    if (v === 'lobby' && lobby) { 
        lobby.classList.add('active-block'); 
    } else if (v === 'room' && room) { 
        room.classList.add('active-flex'); 
        setTimeout(() => resizeCanvas(), 50); 
        if (typeof myCodeEditor !== 'undefined' && myCodeEditor) setTimeout(() => myCodeEditor.refresh(), 50); 
    } 
}

function switchSidebarTab(t) { 
    document.querySelectorAll('.tab-content').forEach(e => e.classList.remove('active-tab')); 
    document.querySelectorAll('.sidebar-tabs button').forEach(e => e.classList.remove('active')); 
    document.getElementById('tab-' + t).classList.add('active-tab'); 
    document.getElementById('btn-' + t).classList.add('active'); 
}

function switchMainStage(s) { 
    if(window.innerWidth <= 850) { const sidebar = document.querySelector('.sidebar'); const overlay = document.getElementById('mobileDrawerOverlay'); if(sidebar) sidebar.classList.remove('drawer-open'); if(overlay) overlay.classList.remove('active'); } 
    // MAGNET LOCK: Prevent guests from clicking Sidebar Apps if Magnet is ON
    if (!isHost && window.isGuestMagnetized && s !== window.magnetizedStageId) {
        alert("Magnet Mode is Active. The Host has locked navigation to the current app.");
        return;
    }

    currentActiveStage = s; 
    if (document.getElementById('cTxtI')) document.getElementById('cTxtI').remove();
    
    document.querySelectorAll('.stage-container').forEach(e => {
        e.classList.remove('active-stage');
        e.style.display = ''; 
    }); 
    
    const vl = document.getElementById('videoLayer'); 
    const target = document.getElementById(s);
    
    if(s === 'videoLayer') { 
        vl.className = 'stage-container active-stage video-grid-full'; 
        vl.style.cssText = '';
        pipX = 0; pipY = 0;
    } else { 
        vl.className = 'stage-container active-stage video-grid-floating'; 
        vl.style.transform = `translate(${pipX}px, ${pipY}px)`;
        
        if (target) {
            target.classList.add('active-stage');
        }
    } 
    
    if(s === 'whiteboardLayer') setTimeout(() => resizeCanvas(), 50); 
    if(s === 'codeLayer' && typeof myCodeEditor !== 'undefined' && myCodeEditor) setTimeout(() => myCodeEditor.refresh(), 50); 
}

function logSystemMsg(text) { 
    const b = document.getElementById('chatBox'); 
    // SECURITY FIX: Strip all HTML from system notifications
    const safeText = window.DOMPurify ? DOMPurify.sanitize(text, {ALLOWED_TAGS: []}) : text;
    b.innerHTML += `<div class="msg system" style="text-align:center; color:#666; font-size:0.75rem; margin:15px 0; letter-spacing:1px; text-transform:uppercase;">${safeText}</div>`; 
    b.scrollTop = b.scrollHeight; 
}

document.addEventListener('keydown', e => {
    if(e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if(e.key.toLowerCase() === 'm') document.getElementById('micBtn').click();
    if(e.key.toLowerCase() === 'v') document.getElementById('camBtn').click();
    if(e.key.toLowerCase() === 'h') toggleHandRaise();
    if(e.key.toLowerCase() === 'c') toggleCaptions();
});

// ==========================================
// 1.5 DRAGGABLE PIP VIDEO LAYER
// ==========================================
const vidLayer = document.getElementById('videoLayer');
let isDraggingPiP = false;
let pipX = 0, pipY = 0;
let startX = 0, startY = 0;

vidLayer.addEventListener('mousedown', dragStart);
window.addEventListener('mousemove', dragMove);
window.addEventListener('mouseup', dragEnd);

vidLayer.addEventListener('touchstart', dragStart, {passive: false});
window.addEventListener('touchmove', dragMove, {passive: false});
window.addEventListener('touchend', dragEnd);

function dragStart(e) {
    if (!vidLayer.classList.contains('video-grid-floating')) return;
    if(e.target.tagName === 'BUTTON' || e.target.tagName === 'I') return;
    
    isDraggingPiP = true;
    let clientX = e.type.includes('mouse') ? e.clientX : e.touches[0].clientX;
    let clientY = e.type.includes('mouse') ? e.clientY : e.touches[0].clientY;
    
    startX = clientX - pipX;
    startY = clientY - pipY;
    vidLayer.style.cursor = 'grabbing';
}

function dragMove(e) {
    if (!isDraggingPiP) return;
    
    let clientX = e.type.includes('mouse') ? e.clientX : e.touches[0].clientX;
    let clientY = e.type.includes('mouse') ? e.clientY : e.touches[0].clientY;
    
    pipX = clientX - startX;
    pipY = clientY - startY;
    
    vidLayer.style.transform = `translate(${pipX}px, ${pipY}px)`;
}

function dragEnd() {
    isDraggingPiP = false;
    if (vidLayer.classList.contains('video-grid-floating')) {
        vidLayer.style.cursor = 'grab';
    }
}

// ==========================================
// EMOJI REACTION SYSTEM
// ==========================================
function toggleReactionBar() {
    const bar = document.getElementById('reactionBar');
    if (bar.style.display === 'none' || bar.style.display === '') {
        bar.style.display = 'flex';
    } else {
        bar.style.display = 'none';
    }
}

function sendReaction(emoji) {
    // 1. Show the emoji floating on our own video
    showReactionUI(peer.id, emoji);
    
    // 2. Broadcast it to everyone else in the room
    broadcastData({type: 'reaction', peerId: peer.id, emoji: emoji});
}
// ==========================================
// CUSTOM SECURE FULLSCREEN
// ==========================================
function toggleCustomFullscreen() {
    // Target the container that holds both the ytPlayer AND the ytGuestShield
    const ytContainer = document.getElementById('ytPlayer').parentElement; 
    
    if (!document.fullscreenElement && !document.webkitFullscreenElement) {
        if (ytContainer.requestFullscreen) ytContainer.requestFullscreen();
        else if (ytContainer.webkitRequestFullscreen) ytContainer.webkitRequestFullscreen(); // Safari
        else if (ytContainer.msRequestFullscreen) ytContainer.msRequestFullscreen(); // IE11
    } else {
        if (document.exitFullscreen) document.exitFullscreen();
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
        else if (document.msExitFullscreen) document.msExitFullscreen();
    }
}
// --- CUSTOM GUEST CONTROLS (Magnet Mode) ---
window.isCustomCCActive = false;

window.toggleCustomCC = function() {
    if (typeof ytPlayer !== 'undefined' && ytPlayer.loadModule) {
        if (!window.isCustomCCActive) {
            ytPlayer.loadModule("captions");
            ytPlayer.setOption("captions", "track", {"languageCode": "en"});
            window.isCustomCCActive = true;
        } else {
            ytPlayer.unloadModule("captions");
            window.isCustomCCActive = false;
        }
    }
};

window.toggleCustomVolume = function() {
    if (typeof ytPlayer !== 'undefined' && typeof ytPlayer.isMuted === 'function') {
        const volBtn = document.getElementById('customVolBtn');
        if (ytPlayer.isMuted()) {
            ytPlayer.unMute();
            if (volBtn) volBtn.innerHTML = '<i class="fas fa-volume-up"></i>';
        } else {
            ytPlayer.mute();
            if (volBtn) volBtn.innerHTML = '<i class="fas fa-volume-mute"></i>';
        }
    }
};
// --- YOUTUBE MASTER SYNC ENGINE ---
// The Host fires a unified Master Sync pulse every 1 second.
setInterval(() => {
    if (isHost && window.magnetMode && currentYtVideoId && typeof ytPlayer !== 'undefined' && typeof ytPlayer.getCurrentTime === 'function') {
        const actualState = ytPlayer.getPlayerState();
        if (actualState === 1 || actualState === 2 || actualState === 3) {
            broadcastData({
                type: 'yt-master-sync',
                vidId: currentYtVideoId,
                time: ytPlayer.getCurrentTime(),
                state: actualState
            });
        }
    }
}, 1000);

// ==========================================
// UI POLISH: CLICK-TO-COPY SPACE ID
// ==========================================
window.addEventListener('load', () => {
    const idEl = document.getElementById('uiShortId');
    if(idEl) {
        idEl.style.cursor = 'pointer';
        idEl.title = 'Click to Copy Space ID'; // Adds a hover tooltip
        
        idEl.onclick = () => {
            const text = idEl.innerText;
            // Ensure they aren't trying to copy the placeholder or Guest label
            if(text !== '---' && text !== 'GUEST' && text !== 'COPIED!') {
                navigator.clipboard.writeText(text).then(() => {
                    // Button Feedback: Flash green to confirm success
                    const origColor = idEl.style.color;
                    idEl.style.color = '#00ff66'; 
                    idEl.innerText = 'COPIED!';
                    
                    setTimeout(() => {
                        idEl.style.color = origColor;
                        idEl.innerText = text;
                    }, 1000);
                    
                    logSystemMsg("Space ID copied to clipboard.");
                }).catch(err => {
                    console.error("Clipboard API blocked by browser: ", err);
                });
            }
        };
    }
});

// ==========================================
// MOBILE RIGHT-SIDE DRAWER
// ==========================================
function toggleMobileDrawer() {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.getElementById('mobileDrawerOverlay');
    if (sidebar && overlay) {
        if (sidebar.classList.contains('drawer-open')) {
            sidebar.classList.remove('drawer-open');
            overlay.classList.remove('active');
        } else {
            sidebar.classList.add('drawer-open');
            overlay.classList.add('active');
        }
    }
}

// ==========================================

// ===========================================
// WEBRTC STREAM MANAGEMENT
// The CORRECT approach for iOS Safari:
// 1. Get the real camera/mic stream at join time (user just tapped Join = user gesture = iOS allows it)
// 2. Keep tracks DISABLED by default (camera/mic off UI)
// 3. Connect WebRTC with this real-but-disabled stream
// 4. When user clicks camera/mic button, just set t.enabled = true
//    → The existing RTCRtpSender already has the track, it just starts sending data
//    → No replaceTrack, no renegotiation, no autoplay issues
// ===========================================

let peer, localStream; 
let safeStreamCache = null;

// Returns the real localStream if available (with disabled tracks), 
// or a silent dummy audio stream as fallback.
function getSafeStream() {
    if (localStream && localStream.active) return localStream;
    if (safeStreamCache) return safeStreamCache;
    
    // Fallback: silent dummy audio (used only if user denied camera permission)
    let dummyStream = new MediaStream();
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const dest = audioCtx.createMediaStreamDestination();
        if (dest.stream.getAudioTracks().length > 0) {
            dummyStream.addTrack(dest.stream.getAudioTracks()[0]);
        }
    } catch (ae) { console.warn("Dummy audio failed:", ae); }
    
    safeStreamCache = dummyStream;
    return safeStreamCache;
}



// Simplified setupCallEvents: always create a fresh video wrapper for incoming streams
window.setupCallEvents = function(call) {
    call.on('stream', rs => {
        const wid = 'wrapper-' + call.peer;
        let w = document.getElementById(wid);
        // Remove any existing wrapper to avoid duplicates
        if (w) w.remove();
        w = document.createElement('div');
        w.id = wid;
        const isOff = window.peerCamStates[call.peer] === false;
        w.className = isOff ? 'video-wrapper video-off' : 'video-wrapper';
        const v = document.createElement('video');
        v.id = call.peer;
        v.autoplay = true;
        v.playsInline = true;
        v.setAttribute('playsinline', 'true');
        v.srcObject = rs;
        v.onloadedmetadata = () => v.play().catch(e => console.warn('Autoplay blocked:', e));
        w.appendChild(v);
        // Name tag
        const nameTag = document.createElement('div');
        nameTag.className = 'video-name-tag';
        nameTag.id = 'name-' + call.peer;
        const member = roomMembers.find(m => m.id === call.peer);
        nameTag.innerText = member ? member.name : (call.peer === currentRoomHostId ? 'Host' : 'Guest');
        w.appendChild(nameTag);
        // Spotlight button
        const spotlightBtn = document.createElement('button');
        spotlightBtn.className = 'spotlight-btn';
        spotlightBtn.innerHTML = '<i class="fas fa-expand"></i>';
        spotlightBtn.onclick = e => { e.stopPropagation(); toggleSpotlight(call.peer); };
        w.appendChild(spotlightBtn);
        document.getElementById('videoLayer').appendChild(w);
        if (typeof setupAudioVisualizer === 'function') setupAudioVisualizer(rs, wid, true);
        if (typeof updateMembersUI === 'function') updateMembersUI();
    });
    // unchanged close and error handlers remain below (will be unchanged)
    call.on('close', () => {
        if (outgoingMediaCalls[call.peer] !== call) return;
        const deadWrapperId = 'wrapper-' + call.peer;
        const deadVideoElement = document.getElementById(deadWrapperId);
        if (deadVideoElement) {
            if (typeof activeVisualizers !== 'undefined' && activeVisualizers[deadWrapperId]) cancelAnimationFrame(activeVisualizers[deadWrapperId]);
            deadVideoElement.remove();
        }
        if (typeof roomMembers !== 'undefined') {
            roomMembers = roomMembers.filter(m => m.id !== call.peer);
            if (typeof updateMembersUI === 'function') updateMembersUI();
        }
        delete outgoingMediaCalls[call.peer];
    });
    call.on('error', err => { console.warn('Call failed:', err); call.close(); });
};
let connections = []; 
let screenCalls = []; 
let roomMembers = [];
window.peerCamStates = {}; // PRIORITY: Fix WebRTC Race Condition for Black Screens
// Tracks outgoing/answered camera MediaConnections by peer id, purely so
// switchCamera() (mobile front/back camera flip) can find each connection's
// RTCPeerConnection sender and replaceTrack() on it. Populated/cleaned up
// alongside the existing call.on('close') handlers below - does not change
// any existing call setup/teardown behavior.
let outgoingMediaCalls = {};
let isHost = false; 
let myDisplayName = "Guest"; 
let myUserId = sessionStorage.getItem('superroom_uid') || crypto.randomUUID();
sessionStorage.setItem('superroom_uid', myUserId);
let myHandRaised = false;

let audioCtx = null;
function getAudioCtx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
}

// ==========================================
// PRIORITY 30: EXTERNAL LIBRARY FAILSAFE
// ==========================================
// If the DOMPurify CDN is blocked (e.g., by an adblocker or firewall), prevent the XSS backdoor.
if (typeof window.DOMPurify === 'undefined') {
    console.warn("SECURITY ALERT: DOMPurify CDN blocked! Initializing native fail-closed sanitizer.");
    window.DOMPurify = {
        sanitize: function(dirty) {
            if (!dirty) return "";
            // Use the browser's native parser to strip ALL HTML mathematically
            const doc = new DOMParser().parseFromString(dirty, 'text/html');
            return doc.body.textContent || ""; 
        }
    };
}

// ==========================================
// PRIORITY 11 & 12: WEBRTC CONNECTIVITY & SCALABILITY
// ==========================================
// Adds robust STUN servers for NAT traversal so mobile/corporate users don't get black screens.
const peerConfig = {
    config: {
        'iceServers': [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
            { urls: 'stun:stun3.l.google.com:19302' },
            { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
            { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
            { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' }
        ],
        'iceTransportPolicy': 'all'
    }
};

async function initCameraMic() {
    if (localStream && localStream.active) return;
    try {
        if (getAudioCtx().state === 'suspended') await getAudioCtx().resume();

        const videoConstraints = isHost ? 
            { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } } : 
            { width: { ideal: 320 }, height: { ideal: 240 }, frameRate: { ideal: 15 } };

        localStream = await navigator.mediaDevices.getUserMedia({ 
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, 
            video: videoConstraints 
        });
        window.currentVideoIsHD = isHost;
        document.getElementById('localVideo').srcObject = localStream;
        localStream.getAudioTracks().forEach(t => t.enabled = false);
        localStream.getVideoTracks().forEach(t => t.enabled = false);

        document.getElementById('wrapper-local').classList.add('video-off');
        
        const micBtn = document.getElementById('micBtn');
        const camBtn = document.getElementById('camBtn');
        micBtn.innerHTML = '<i class="fas fa-microphone-slash"></i>';
        camBtn.innerHTML = '<i class="fas fa-video-slash"></i>';
        micBtn.classList.remove('active');
        camBtn.classList.remove('active');
        
        setupAudioVisualizer(localStream, 'wrapper-local', false);
    } catch(e) { 
        let errMsg = "Media access denied.";
        if (e.name === 'NotAllowedError') errMsg = "Permission denied. Please allow camera/mic access in your browser.";
        else if (e.name === 'NotFoundError') errMsg = "No camera or microphone found on this device.";
        else if (e.name === 'NotReadableError') errMsg = "Hardware is already in use by another application.";
        else if (e.name === 'OverconstrainedError') errMsg = "Your camera does not support the requested resolution.";
        else if (e.name === 'SecurityError') errMsg = "Media access is disabled due to security restrictions (HTTPS required).";

        logSystemMsg("⚠️ " + errMsg);
        
        const statusEl = document.getElementById('uiStatus');
        if (statusEl) { statusEl.innerText = "⚠️ Media Blocked"; statusEl.style.color = "#f39c12"; }
        
        const localVidBox = document.getElementById('wrapper-local');
        if (localVidBox) {
            localVidBox.innerHTML = `
                <div style="display:flex; height:100%; width:100%; align-items:center; justify-content:center; color:#666; flex-direction:column; text-align:center; padding:20px; box-sizing:border-box;">
                    <i class="fas fa-video-slash" style="font-size:2rem; margin-bottom:10px; color:#ff4444;"></i>
                    <span style="font-size:0.8rem; text-transform:uppercase; letter-spacing:1px;">Media Blocked</span>
                </div>`;
        }
    }
}

let isHardwareLocked = false;

// Standard Camera Button 
document.getElementById('camBtn').onclick = async function() { 
    if (isHardwareLocked && !isHost) {
        alert("The Host has locked your camera.");
        return;
    }
    
    // If stream not yet initialized (camera denied at join), try again now
    if (!localStream) {
        await initCameraMic();
        if (!localStream) return;
    }
    
    const t = localStream.getVideoTracks()[0]; 
    if (!t) return;
    t.enabled = !t.enabled;
    
    this.classList.toggle('active', t.enabled); 
    this.innerHTML = t.enabled ? '<i class="fas fa-video"></i>' : '<i class="fas fa-video-slash"></i>'; 
    
    const w = document.getElementById('wrapper-local'); 
    if (t.enabled) {
        w.classList.remove('video-off'); 
    } else {
        w.classList.add('video-off'); 
    }
    
    if (peer && peer.id) {
        broadcastData({type: 'cam-state', state: t.enabled, peerId: peer.id});
    }
};

document.getElementById('micBtn').onclick = async function() { 
    if (isHardwareLocked && !isHost) {
        alert("The Host has locked your microphone.");
        return;
    }
    
    // If stream not yet initialized (mic denied at join), try again now
    if (!localStream) {
        await initCameraMic();
        if (!localStream) return;
    }
    
    const t = localStream.getAudioTracks()[0]; 
    if (!t) return;
    t.enabled = !t.enabled;
    
    this.classList.toggle('active', t.enabled); 
    this.innerHTML = t.enabled ? '<i class="fas fa-microphone"></i>' : '<i class="fas fa-microphone-slash"></i>'; 
};

// PRIORITY 9: AUDIO VISUALIZER LIFECYCLE MANAGEMENT
const activeVisualizers = {}; // Store frame IDs so we can cancel them safely

function setupAudioVisualizer(stream, wrapperId, isRemote) {
    try {
        const source = getAudioCtx().createMediaStreamSource(stream);
        const analyser = getAudioCtx().createAnalyser(); 
        analyser.fftSize = 64;
        
        if(isRemote) {
            const panner = getAudioCtx().createPanner(); 
            panner.panningModel = 'HRTF';
            panner.positionX.value = Math.random() > 0.5 ? 1 : -1; 
            source.connect(panner); 
            panner.connect(analyser); 
            analyser.connect(getAudioCtx().destination);
            
            const vid = document.querySelector(`#${wrapperId} video`); 
            if(vid) vid.muted = true; 
        } else { 
            source.connect(analyser); 
        }

        const data = new Uint8Array(analyser.frequencyBinCount);
        
        // Prevent duplicate canvases if re-initialized
        let canvas = document.querySelector(`#${wrapperId} .audio-vis`);
        if (!canvas) {
            canvas = document.createElement('canvas'); 
            canvas.className = 'audio-vis'; 
            document.getElementById(wrapperId).appendChild(canvas);
        }
        const ctx = canvas.getContext('2d');

        // Cancel previous loop if re-initializing the same stream to prevent stacking
        if (activeVisualizers[wrapperId]) cancelAnimationFrame(activeVisualizers[wrapperId]);

        let lastDrawTime = 0;
        function draw(timestamp) {
            // LIFECYCLE CHECK: If the video box was removed from the DOM, stop looping to save CPU/RAM!
            if(!document.getElementById(wrapperId)) {
                delete activeVisualizers[wrapperId];
                return;
            }
            
            // PRIORITY 22: Throttle the canvas flashing to a slow 5 FPS if reduced-motion is requested
            if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
                if (timestamp - lastDrawTime < 200) { // Wait 200ms between frames
                    activeVisualizers[wrapperId] = requestAnimationFrame(draw);
                    return;
                }
                lastDrawTime = timestamp;
            }
            
            analyser.getByteFrequencyData(data);
            let sum = 0; 
            for(let i=0; i<data.length; i++) sum += data[i]; 
            let avg = sum / data.length;
            
            if(avg > 15) document.getElementById(wrapperId).classList.add('speaker-active');
            else document.getElementById(wrapperId).classList.remove('speaker-active');
            
            ctx.clearRect(0, 0, canvas.width, canvas.height); 
            ctx.beginPath(); 
            ctx.arc(canvas.width/2, canvas.height/2, 30 + (avg/2), 0, 2 * Math.PI); 
            const themeAccent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#e60000';
            ctx.strokeStyle = themeAccent; 
            ctx.globalAlpha = avg/100; ctx.lineWidth = 4; ctx.stroke(); ctx.globalAlpha = 1.0; 
            
            activeVisualizers[wrapperId] = requestAnimationFrame(draw);
        } 
        draw();
    } catch(e) {
        console.warn("Audio Visualizer failed to attach to stream.");
    }
}

function updateMembersUI() { 
    const list = document.getElementById('membersList'); 
    list.innerHTML = '';
    
    // NEW: Master Lock Controls
    if (isHost && roomMembers.length > 1) {
        list.innerHTML += `
            <div style="display:flex; gap:10px; margin-bottom:15px; padding-bottom:15px; border-bottom:1px solid var(--border-color);">
                <button onclick="lockAllHardware(true)" class="btn-danger" style="flex:1; padding:8px; font-size:0.75rem;"><i class="fas fa-lock"></i> Lock All</button>
                <button onclick="lockAllHardware(false)" class="btn-secondary" style="flex:1; padding:8px; font-size:0.75rem; border-color:#2ecc71; color:#2ecc71;"><i class="fas fa-unlock"></i> Unlock All</button>
            </div>
        `;
    }

    roomMembers.forEach(m => {
        // SECURITY FIX: Sanitize display names to prevent XSS in the participant list
        const safeName = window.DOMPurify ? DOMPurify.sanitize(m.name, {ALLOWED_TAGS: []}) : m.name;
        let controls = ''; 
        if(isHost) {
            const ackBtn = (m.handRaised && m.id !== peer.id) ? `<button onclick="ackHand('${m.id}')" class="btn-secondary" style="padding:5px 10px; margin-right:5px; border-color:var(--accent); color:var(--accent);" title="Acknowledge"><i class="fas fa-check"></i></button>` : '';
            const kickMute = (m.id !== peer.id) ? `
                <button onclick="toggleHardwareLock('${m.id}')" class="btn-secondary" style="padding:5px 10px; margin-right:5px; border-color:#9b59b6; color:#9b59b6;" title="Lock/Unlock Hardware"><i class="fas fa-lock"></i></button>
                <button onclick="requestCamOn('${m.id}')" class="btn-secondary" style="padding:5px 10px; margin-right:5px; border-color:#3498db; color:#3498db;" title="Request Camera On"><i class="fas fa-video"></i></button>
                <button onclick="forceCamOff('${m.id}')" class="btn-secondary" style="padding:5px 10px; margin-right:5px; border-color:#e74c3c; color:#e74c3c;" title="Force Camera Off"><i class="fas fa-video-slash"></i></button>
                <button onclick="muteMember('${m.id}')" class="btn-secondary" style="padding:5px 10px; margin-right:5px; border-color:#f39c12; color:#f39c12;" title="Force Mute"><i class="fas fa-microphone-slash"></i></button>
                <button onclick="kickMember('${m.id}')" class="btn-danger" style="padding:5px 10px;" title="Kick"><i class="fas fa-sign-out-alt"></i></button>
            ` : '';

            controls = `
                ${ackBtn}
                <button onclick="triggerSpotlight('${m.id}')" class="btn-secondary" style="padding:5px 10px; margin-right:5px; border-color:#00ff66; color:#00ff66;" title="Spotlight Video"><i class="fas fa-thumbtack"></i></button>
                ${kickMute}
            `;
        }
        
        list.innerHTML += `
            <div style="display:flex; justify-content:space-between; align-items:center; background:#050505; padding:15px; border-radius:2px; margin-bottom:8px; border:1px solid ${m.handRaised ? 'var(--accent)' : 'var(--border-color)'};">
                <div style="color: var(--text-light); font-weight: 500; font-size:0.9rem;">
                    ${safeName} 
                    ${m.isHost ? '<span style="color:var(--accent); font-size:0.7rem; letter-spacing:1px; margin-left:5px; text-transform:uppercase;">Host</span>' : ''}
                    ${m.id === peer.id ? '<span style="color:#666; font-size:0.7rem; letter-spacing:1px; margin-left:5px; text-transform:uppercase;">You</span>' : ''} 
                    ${m.handRaised ? '<i class="fas fa-hand-paper" style="color:var(--accent); margin-left:8px;"></i>' : ''}
                </div>
                <div style="display:flex;">${controls}</div>
            </div>
        `;
        
        const wrapper = document.getElementById(m.id === peer.id ? 'wrapper-local' : 'wrapper-' + m.id); 
        if(wrapper) { 
            if(m.handRaised) wrapper.classList.add('hand-raised-video'); 
            else wrapper.classList.remove('hand-raised-video'); 
        }
    });
}
async function hostRoom() {
    // 1. INSTANTLY RENDER THE UI (Prevents Black Screen)
    switchView('room');
    switchMainStage('videoLayer');
    if (document.getElementById('uiStatus')) document.getElementById('uiStatus').innerText = "Requesting Camera...";
    
  let maxMembers = parseInt(document.getElementById('roomCapacityInput').value) || 2; 
  window.currentMaxMembers = maxMembers;
    currentMembers = 1; 
   isHost = true; 
    window.magnetMode = false;
    window.isGuestMagnetized = false;
    if (document.getElementById('ytGuestShield')) document.getElementById('ytGuestShield').style.display = 'none';
    if (document.getElementById('ytGuestShield')) document.getElementById('ytGuestShield').style.display = 'none';
    
    if (document.getElementById('hostTimerControls')) document.getElementById('hostTimerControls').style.display = 'block'; 
    if (document.getElementById('hostPollControls')) document.getElementById('hostPollControls').style.display = 'block'; 
    if (document.getElementById('hostBreakoutControls')) document.getElementById('hostBreakoutControls').style.display = 'block';
    if (document.getElementById('hostControlsPanel')) document.getElementById('hostControlsPanel').style.display = 'block';
    if (document.getElementById('forceSyncBtn')) document.getElementById('forceSyncBtn').style.display = 'inline-block';
    if (document.getElementById('hostMediaControls')) document.getElementById('hostMediaControls').style.display = 'block';

    // 2. GET CAMERA/MIC (user just clicked "Create Room" = user gesture = iOS allows getUserMedia)
    await initCameraMic(); 
    
    if (document.getElementById('uiStatus')) document.getElementById('uiStatus').innerText = "Connecting to Server...";

   // 3. ESTABLISH PEER CONNECTION
    const customId = crypto.randomUUID().split('-')[0].toUpperCase();
    if (peer) peer.destroy();
    
    // PRIORITY 11: Apply NAT Traversal configuration
    peer = new Peer(customId, peerConfig);
    
    peer.on('error', err => {
        if (['browser-incompatible', 'invalid-id', 'invalid-key'].includes(err.type)) {
            if(document.getElementById('globalLoader')) document.getElementById('globalLoader').style.display = 'none'; alert('WebRTC Connection Dropped: ' + err.type + '.\n\nAttempting to reconnect without disrupting your camera...');
            if(peer && !peer.destroyed) peer.reconnect(); else leaveRoom();
        } else {
            console.warn("PeerJS non-fatal error (Host):", err.type);
        }
    });

peer.on('open', id => { 
        if (document.getElementById('uiShortId')) document.getElementById('uiShortId').innerText = id; 
        
        const statusEl = document.getElementById('uiStatus');
        if (statusEl) { statusEl.innerText = "🟢 Hosting"; statusEl.style.color = "#00ff66"; }
        
        // RECONNECTION ENGINE: Automatically reconnect if Wi-Fi drops
        peer.on('disconnected', () => {
            if (statusEl) { statusEl.innerText = "🟡 Reconnecting..."; statusEl.style.color = "#f39c12"; }
            logSystemMsg("Network interrupted. Reconnecting space...");
            peer.reconnect();
        });

        peer.on('close', () => {
            if (statusEl) { statusEl.innerText = "🔴 Offline"; statusEl.style.color = "#ff4444"; }
        });
        
        roomMembers = [{id: id, userId: myUserId, name: myDisplayName, isHost: true, handRaised: false}];
        updateMembersUI(); 

       // PRIORITY 29: Strictly limit Lobby Input lengths
        const rawRoomName = document.getElementById('roomNameInput').value.trim() || `${myDisplayName}'s Space`;
        const roomName = rawRoomName.substring(0, 50); // Max 50 chars
        const roomPin = document.getElementById('roomPinInput') ? document.getElementById('roomPinInput').value.trim().substring(0, 20) : '';
        const roomTopic = document.getElementById('roomTopicInput') ? document.getElementById('roomTopicInput').value.substring(0, 30) : 'General';

      // PRIORITY 3: SALTED HASHING FOR ROOM PINS
        const hashPIN = async (pin, salt) => {
            if (!pin) return "";
            // We use the unique Room ID as a cryptographic salt to prevent Rainbow Table attacks
            const saltedPin = pin + "::" + salt + "::SuperRoomPro"; 
            const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(saltedPin));
            return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
        };

        hashPIN(roomPin, id).then(hashedPin => {
            db.ref('rooms/' + id).set({
                roomId: id,
                roomName: roomName,
                topic: roomTopic,
                hostName: myDisplayName,
                capacity: maxMembers,
                isLocked: roomPin.length > 0,
                pin: hashedPin
            });
            db.ref('rooms/' + id).onDisconnect().remove();
        });

        db.ref('rooms/' + id).onDisconnect().remove();
    });
    
   peer.on('connection', c => {
        if (roomMembers.length >= maxMembers) { 
            const kick = () => { c.send(JSON.stringify({type: 'kicked'})); setTimeout(() => c.close(), 500); };
            if (c.open) kick(); else c.on('open', kick);
            return; 
        }
        
        // PRIORITY 10: STALE CONNECTION CLEANUP
        // If this peer already exists (e.g. they dropped and reconnected), purge the dead connection first
        const existingIdx = connections.findIndex(existing => existing.peer === c.peer);
        if (existingIdx !== -1) {
            connections[existingIdx].close();
            connections.splice(existingIdx, 1);
        } else {
            currentMembers++; 
        }

        connections.push(c); 
        setupDataChannelHandlers(c);
        
        c.on('open', () => {
            if (localStream && localStream.getVideoTracks()[0]) {
                c.send(JSON.stringify({type: 'cam-state', state: localStream.getVideoTracks()[0].enabled, peerId: peer.id}));
            }
        });
        
        c.on('close', () => { 
            // Ensure we don't accidentally remove a fresh reconnection by verifying THIS is the active one
            if (!connections.includes(c)) return; 
            
            connections = connections.filter(existing => existing !== c);
            currentMembers = connections.length + 1; // Recalculate accurately (+1 for host)
            roomMembers = roomMembers.filter(x => x.id !== c.peer); 
            
            // Clean up UI elements of dropped peer
            const deadWrapper = document.getElementById('wrapper-' + c.peer);
            if (deadWrapper) {
                if (typeof activeVisualizers !== 'undefined' && activeVisualizers['wrapper-' + c.peer]) {
                    cancelAnimationFrame(activeVisualizers['wrapper-' + c.peer]);
                }
                deadWrapper.remove();
            }
            if (outgoingMediaCalls[c.peer]) {
                outgoingMediaCalls[c.peer].close();
                delete outgoingMediaCalls[c.peer];
            }

            updateMembersUI(); 
            broadcastData({type: 'members-update', list: roomMembers}); 
        });
        
        c.on('error', (err) => {
            console.warn("Data connection error with peer:", c.peer, err);
            c.close();
        });
    });
    
    handlePeerCalls();
}

async function joinRoom() {
    const targetId = document.getElementById('lobbyJoinId').value.trim().toUpperCase();
    currentRoomHostId = targetId; 
    const enteredPin = document.getElementById('lobbyJoinPin') ? document.getElementById('lobbyJoinPin').value.trim() : '';

    if (!targetId) {
        alert("Please enter a valid Space ID to join.");
        return; 
    }

    try {
        const roomSnapshot = await db.ref('rooms/' + targetId).once('value');
        if (roomSnapshot.exists()) {
          const roomData = roomSnapshot.val();
            
           // PRIORITY 3: SALTED HASH VALIDATION
            const saltedEnteredPin = enteredPin + "::" + targetId + "::SuperRoomPro";
            const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(saltedEnteredPin));
            const hashedEnteredPin = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
            
            if (roomData.isLocked && roomData.pin !== hashedEnteredPin) {
                alert("Incorrect Passcode! Please enter the correct PIN to join.");
                return; 
            }
        }
    } catch(e) {
        console.log("Room lookup skipped or Firebase not connected.");
    }
    
    // 1. INSTANTLY RENDER THE UI (Prevents Black Screen)
    switchView('room');
   switchMainStage('videoLayer');
    if (document.getElementById('uiStatus')) document.getElementById('uiStatus').innerText = "Requesting Camera...";
    
  isHost = false; 
    window.magnetMode = false;
    window.isGuestMagnetized = false;
    if (document.getElementById('ytGuestShield')) document.getElementById('ytGuestShield').style.display = 'none';
        
    // 2. GET CAMERA/MIC (user just clicked "Join Room" = user gesture = iOS allows getUserMedia)
    await initCameraMic(); 
    
    if (document.getElementById('uiStatus')) document.getElementById('uiStatus').innerText = "Connecting to Host...";

   // 3. ESTABLISH PEER CONNECTION
    if (peer) peer.destroy();
    
    // PRIORITY 11: Apply NAT Traversal configuration
    peer = new Peer(peerConfig);
    
    peer.on('error', err => {
        if (['browser-incompatible', 'invalid-id', 'invalid-key', 'peer-unavailable'].includes(err.type)) {
            if(document.getElementById('globalLoader')) document.getElementById('globalLoader').style.display = 'none'; alert('WebRTC Connection Dropped: ' + err.type + '.\n\nAttempting to reconnect without disrupting your camera...');
            if(peer && !peer.destroyed) peer.reconnect(); else leaveRoom();
        } else {
            console.warn("PeerJS non-fatal error (Guest):", err.type);
        }
    });
    
    peer.on('open', id => {
        if (document.getElementById('uiShortId')) document.getElementById('uiShortId').innerText = "GUEST"; 
        
        const statusEl = document.getElementById('uiStatus');
        if (statusEl) { statusEl.innerText = "🟢 Connected"; statusEl.style.color = "#00ff66"; }
        
        // RECONNECTION ENGINE
        peer.on('disconnected', () => {
            if (statusEl) { statusEl.innerText = "🟡 Reconnecting..."; statusEl.style.color = "#f39c12"; }
            logSystemMsg("Connection lost. Attempting to reconnect...");
            peer.reconnect();
        });
        
        peer.on('close', () => {
            if (statusEl) { statusEl.innerText = "🔴 Disconnected"; statusEl.style.color = "#ff4444"; }
            leaveRoom();
        });
        
        const c = peer.connect(targetId); 
        connections.push(c); 
        setupDataChannelHandlers(c);
        
        c.on('open', () => { 
            c.send(JSON.stringify({type: 'hello', name: myDisplayName, peerId: id, userId: myUserId})); 
            if (localStream && localStream.getVideoTracks()[0]) {
                c.send(JSON.stringify({type: 'cam-state', state: localStream.getVideoTracks()[0].enabled, peerId: id})); 
            }
        });

        // HOST CRASH PROTECTION: Automatically leave if the Host's browser closes
        c.on('close', () => {
            alert("The Host has ended the session or lost connection.");
            leaveRoom();
        });
        
        {
            const call = peer.call(targetId, getSafeStream());
            outgoingMediaCalls[call.peer] = call;
            setupCallEvents(call);
        }
    }); 
    
    handlePeerCalls();
}

function handlePeerCalls() {
    peer.on('call', call => {
        // PRIORITY 10: Screen-share recovery and cleanup
        if(call.metadata && call.metadata.isScreenShare) { 
            call.answer(); 
            call.on('stream', s => { 
                document.getElementById('sharedScreenVideo').srcObject = s; 
                switchMainStage('screenLayer'); 
            });
            call.on('close', () => {
                document.getElementById('sharedScreenVideo').srcObject = null;
                if (currentActiveStage === 'screenLayer') switchMainStage('videoLayer');
            });
            return; 
        }
        
        // The data channel handles capacity kicks and will force the guest to drop.
        // Doing it here risks race conditions with returning users who haven't updated their peer.id yet via 'hello'.
        
        if (outgoingMediaCalls[call.peer]) {
            outgoingMediaCalls[call.peer].close();
        }
        call.answer(getSafeStream());
        outgoingMediaCalls[call.peer] = call;
        setupCallEvents(call);
    });
}

function leaveRoom() { 
    // 1. FIREBASE CLEANUP (Host specific)
    if (isHost && peer && peer.id) {
        db.ref('rooms/' + peer.id).remove();
    }

    // 2. PRIORITY 24/25/26: TIMERS, LOOPS & BACKGROUND PROCESS PURGE
    if (typeof timerInterval !== 'undefined') clearInterval(timerInterval);
    if (typeof fileTransferTimeout !== 'undefined') clearTimeout(fileTransferTimeout);
    document.getElementById('sharedTimerDisplay').style.display = 'none';
    
    // Hide all host-only controls upon exiting
    if (document.getElementById('hostTimerControls')) document.getElementById('hostTimerControls').style.display = 'none'; 
    if (document.getElementById('hostPollControls')) document.getElementById('hostPollControls').style.display = 'none'; 
    if (document.getElementById('hostBreakoutControls')) document.getElementById('hostBreakoutControls').style.display = 'none';
    if (document.getElementById('hostControlsPanel')) document.getElementById('hostControlsPanel').style.display = 'none';
    if (document.getElementById('forceSyncBtn')) document.getElementById('forceSyncBtn').style.display = 'none';
    if (document.getElementById('hostMediaControls')) document.getElementById('hostMediaControls').style.display = 'none';

    // Kill Audio Visualizers
    if (typeof activeVisualizers !== 'undefined') {
        Object.keys(activeVisualizers).forEach(key => cancelAnimationFrame(activeVisualizers[key]));
        for (let key in activeVisualizers) delete activeVisualizers[key];
    }
    
    // Kill AI Gestures
    if (typeof gestureActive !== 'undefined' && gestureActive) {
        gestureActive = false;
        const aiBtn = document.getElementById('aiGestureBtn');
        if (aiBtn) aiBtn.classList.remove('active');
    }
    
    // Kill Live Captions
    if (typeof recognition !== 'undefined' && recognition) {
        recognition.stop();
        recognition = null;
    }
    
    // Kill Meeting Recorder
    if (typeof isRecording !== 'undefined' && isRecording && mediaRecorder) {
        mediaRecorder.stop();
        isRecording = false;
        const recBtn = document.getElementById('recordBtn');
        if (recBtn) recBtn.classList.remove('recording');
    }

    // 3. WEBRTC ENGINE & MEDIA PURGE
    connections.forEach(c => c.close());
    screenCalls.forEach(c => c.close()); 
    connections = []; 
    screenCalls = []; 
    outgoingMediaCalls = {};
    isHost = false; 
    
    if (typeof roomMembers !== 'undefined') roomMembers = []; 
    
    if (peer) {
        peer.destroy(); 
        peer = null;
    }
    
    // Kill Camera and Mic Hardware
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }

    // PRIORITY 26: CLEAN UP SCREEN SHARE TRACKS
    const screenVid = document.getElementById('sharedScreenVideo');
    if (screenVid && screenVid.srcObject) {
        screenVid.srcObject.getTracks().forEach(t => t.stop());
        screenVid.srcObject = null;
    }
    
    // 4. COMPLETE UI & DOM WIPE
    const cmWrapper = document.querySelector('.CodeMirror');
    if (cmWrapper && cmWrapper.CodeMirror) {
        cmWrapper.CodeMirror.setValue('');
        cmWrapper.CodeMirror.clearHistory();
    }
    if (document.getElementById('codeEditorArea')) document.getElementById('codeEditorArea').value = '';
    if (document.getElementById('codeOutput')) {
        document.getElementById('codeOutput').srcdoc = '';
        document.getElementById('codeOutput').src = 'about:blank';
    }

    if (document.getElementById('chatBox')) document.getElementById('chatBox').innerHTML = '';
    if (document.getElementById('membersList')) document.getElementById('membersList').innerHTML = '';
    if (document.getElementById('mdInput')) document.getElementById('mdInput').value = '';
    if (document.getElementById('mdOutput')) document.getElementById('mdOutput').innerHTML = '';
    if (typeof clearWhiteboard === 'function') clearWhiteboard(false);
    
    if (document.getElementById('mediaRenderContainer')) {
        document.getElementById('mediaRenderContainer').innerHTML = `<p style="color:#666; letter-spacing:2px; text-transform:uppercase;">No media presented.</p>`;
    }
    if (document.getElementById('fileUpload')) document.getElementById('fileUpload').value = '';
    if (document.getElementById('globalFileProgressWrapper')) document.getElementById('globalFileProgressWrapper').style.display = 'none';
    
    if (typeof rxFileChunks !== 'undefined') {
        rxFileChunks = []; rxFileTotal = 0; rxFileName = ""; rxFileMime = "";
    }
    if (typeof sessionResources !== 'undefined') {
        sessionResources = [];
        const cabList = document.getElementById('resourceCabinetList');
        if (cabList) cabList.innerHTML = `<p style="color:#444; font-size:0.85rem; font-style:italic; text-align:center; margin-top:20px;">No resources shared yet.</p>`;
    }

    if (document.getElementById('sharedBrowser')) document.getElementById('sharedBrowser').src = 'about:blank';
    if (document.getElementById('ytInput')) document.getElementById('ytInput').value = '';
    if (typeof ytPlayer !== 'undefined' && ytPlayer && typeof ytPlayer.stopVideo === 'function') {
        ytPlayer.stopVideo();
    }
    currentYtVideoId = null; 
    
    // Wipe Video Grid
    document.getElementById('videoLayer').innerHTML = `<div id="wrapper-local" class="video-wrapper video-off"><video id="localVideo" autoplay muted playsinline></video><div class="video-avatar"><div class="voice-pulse pulse-anim"><i class="fas fa-microphone"></i></div></div></div>`; 
    
    if (document.getElementById('uiShortId')) document.getElementById('uiShortId').innerText = "---";
    if (document.getElementById('uiStatus')) document.getElementById('uiStatus').innerText = "Disconnected";
    
    isHardwareLocked = false;
    currentActiveStage = 'videoLayer';
    switchMainStage('videoLayer');
    
    const rBar = document.getElementById('reactionBar');
    if (rBar) rBar.style.display = 'none';
    
    switchView('lobby'); 
}

function toggleHandRaise() { 
    myHandRaised = !myHandRaised; 
    document.getElementById('handBtn').classList.toggle('hand-raised'); 
    
    if(isHost) {
        const _me = roomMembers.find(x => x.id === peer.id); if (_me) _me.handRaised = myHandRaised;
        updateMembersUI();
        broadcastData({type: 'members-update', list: roomMembers});
    } else {
        broadcastData({type: 'hand-toggle', state: myHandRaised, peerId: peer.id}); 
    }
}

function ackHand(id) { 
    roomMembers.find(x => x.id === id).handRaised = false; 
    updateMembersUI(); 
    broadcastData({type: 'members-update', list: roomMembers}); 
    connections.find(x => x.peer === id)?.send(JSON.stringify({type: 'hand-ack'})); 
}


function sendBreakout() { 
    if(!isHost) return; 
    const n = parseInt(document.getElementById('breakoutCount').value) || 2; 
    let rIds = Array(n).fill().map(() => crypto.randomUUID().split('-')[0].toUpperCase()); 
    
    roomMembers.forEach((m, i) => {
        if(m.id !== peer.id) {
            connections.find(c => c.peer === m.id)?.send(JSON.stringify({
                type: 'breakout', 
                nr: rIds[i % n], 
                mr: document.getElementById('uiShortId').innerText
            }));
        }
    }); 
    logSystemMsg("Users transferred to designated sub-spaces."); 
}

function returnToMain() { 
    const m = document.getElementById('returnMainRoomBtn').dataset.main; 
    document.getElementById('lobbyJoinId').value = m; 
    document.getElementById('returnMainRoomBtn').style.display = 'none'; 
    leaveRoom(); 
    setTimeout(joinRoom, 1000); 
}

// ==========================================
// PRIORITY 28: SCREEN SHARE TOGGLE & CLEANUP
// ==========================================
let isScreenSharing = false;
let localScreenStream = null;

document.getElementById('screenBtn').onclick = async function() { 
    if (!isScreenSharing) {
        // MOBILE PLATFORM LIMITATION: iOS Safari (and every browser on iOS, since
        // they all run on WebKit) does not implement getDisplayMedia at all, and
        // support on Android browsers is inconsistent. This is a browser/OS
        // restriction, not something a web app can code around - so detect it
        // and tell the user the truth instead of the previous misleading
        // "permission denied" message.
        if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
            logSystemMsg("⚠️ Screen sharing isn't supported by this browser/device (this is a platform limitation, most notably on iOS Safari - not a bug in this app).");
            return;
        }
        try { 
            localScreenStream = await navigator.mediaDevices.getDisplayMedia({video: {frameRate: {max: 15}}, audio: true}); 
            document.getElementById('sharedScreenVideo').srcObject = localScreenStream; 
            document.getElementById('sharedScreenVideo').muted = true; 
            switchMainStage('screenLayer'); 
            this.classList.add('active'); 
            isScreenSharing = true;
            
            // Broadcast the screen to all guests
            connections.forEach(c => screenCalls.push(peer.call(c.peer, localScreenStream, {metadata: {isScreenShare: true}}))); 
            
            // Auto-cleanup if the user clicks the browser's native OS "Stop Sharing" button
            localScreenStream.getVideoTracks()[0].onended = () => {
                stopScreenShare();
            }; 
        } catch(e) {
            console.warn("Screen share permission denied or failed:", e);
            logSystemMsg("Screen share cancelled or permission denied.");
        }
    } else {
        // Handle manual toggle off via the UI button
        stopScreenShare();
    }
};

// MOBILE FEATURE ADD: front/back camera switch. Desktop devices generally
// only have one camera so this was never needed there; phones/tablets have
// two, and without this the camera button alone can't reach the rear camera.
// Uses facingMode + RTCRtpSender.replaceTrack so it swaps the live track on
// every existing peer connection without renegotiating (same pattern the
// screen-share code already relies on for track handling).
let currentFacingMode = 'user';
async function switchCamera() {
    if (!localStream || !localStream.getVideoTracks()[0] || !localStream.getVideoTracks()[0].enabled) {
        logSystemMsg("Turn your camera on first, then you can flip it.");
        return;
    }
    
    // Capability check for multiple cameras
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoInputs = devices.filter(d => d.kind === 'videoinput');
    if (videoInputs.length <= 1) {
        logSystemMsg("Only one camera detected on this device.");
        return;
    }

    const track = localStream.getVideoTracks()[0];
    const previousFacingMode = currentFacingMode;
    currentFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';
    
    try {
        const newStream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: { facingMode: { exact: currentFacingMode } }
        });
        const newTrack = newStream.getVideoTracks()[0];
        if (!newTrack) throw new Error("No track");

        Object.values(outgoingMediaCalls).forEach(call => {
            const pc = call && call.peerConnection;
            const sender = pc && pc.getSenders ? pc.getSenders().find(s => s.track && s.track.kind === 'video') : null;
            if (sender) sender.replaceTrack(newTrack);
        });

        localStream.removeTrack(track);
        track.stop();
        localStream.addTrack(newTrack);
        document.getElementById('localVideo').srcObject = localStream;
    } catch (e) {
        console.warn("Camera switch failed, attempting fallback:", e);
        currentFacingMode = previousFacingMode;
        try {
            // Fallback to ideal if exact fails
            const fallbackStream = await navigator.mediaDevices.getUserMedia({
                audio: false,
                video: { facingMode: { ideal: currentFacingMode === 'user' ? 'environment' : 'user' } }
            });
            const fallbackTrack = fallbackStream.getVideoTracks()[0];
            if(fallbackTrack) {
                currentFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';
                Object.values(outgoingMediaCalls).forEach(call => {
                    const pc = call && call.peerConnection;
                    const sender = pc && pc.getSenders ? pc.getSenders().find(s => s.track && s.track.kind === 'video') : null;
                    if (sender) sender.replaceTrack(fallbackTrack);
                });
                localStream.removeTrack(track);
                track.stop();
                localStream.addTrack(fallbackTrack);
                document.getElementById('localVideo').srcObject = localStream;
            }
        } catch(err) {
            logSystemMsg("Couldn't switch camera - permission denied or unsupported.");
        }
    }
}
window.switchCamera = switchCamera;

function stopScreenShare() {
    const btn = document.getElementById('screenBtn');
    if (btn) btn.classList.remove('active');
    
    // Kill the hardware tracks to remove the browser's sharing indicator
    if (localScreenStream) {
        localScreenStream.getTracks().forEach(t => t.stop());
        localScreenStream = null;
    }
    
    // Drop all active WebRTC screen calls
    screenCalls.forEach(c => c.close());
    screenCalls = [];
    isScreenSharing = false;
    
    // Clear DOM Memory
    const screenVideo = document.getElementById('sharedScreenVideo');
    if (screenVideo) screenVideo.srcObject = null;
    
    // Restore layout
    if (currentActiveStage === 'screenLayer') switchMainStage('videoLayer');
}

// ==========================================
// PRIORITY 27: LOCAL RECORDING ENGINE (Screen Capture)
// ==========================================
let mediaRecorder = null; 
let recChunks = []; 
let isRecording = false;
let recordingStream = null; // Need to track this to kill the hardware light!

async function toggleRecording() { 
    const r = document.getElementById('recordBtn'); 
    
    if(!isRecording) {
        // Browser Support Check
        if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
            alert("Your browser does not support local screen recording.");
            return;
        }

        try {
            logSystemMsg("Starting local screen capture. This is saved to your device, not a server.");
            
            recordingStream = await navigator.mediaDevices.getDisplayMedia({video: {frameRate: {max: 15}}, audio: true});
            recChunks = [];
            
            // Dynamic MIME support check
            let mime = '';
            const types = ['video/webm; codecs=vp9', 'video/webm; codecs=vp8', 'video/webm', 'video/mp4'];
            for (let t of types) {
                if (MediaRecorder.isTypeSupported(t)) {
                    mime = t;
                    break;
                }
            }
            if (!mime) {
                alert("Your browser does not support any known recording formats.");
                recordingStream.getTracks().forEach(track => track.stop());
                recordingStream = null;
                return;
            }
            
            mediaRecorder = new MediaRecorder(recordingStream, {mimeType: mime});
            const ext = mime.includes('mp4') ? 'mp4' : 'webm';
            
            mediaRecorder.ondataavailable = e => { if(e.data.size > 0) recChunks.push(e.data); };
            
            mediaRecorder.onstop = () => {
                const blob = new Blob(recChunks, {type: mime});
                const u = URL.createObjectURL(blob);
                const filename = `SuperRoom-Local-Record-${Date.now()}.${ext}`;
                
                // Attempt auto-download (often fails on mobile)
                const a = document.createElement('a');
                a.href = u;
                a.download = filename;
                a.style.display = 'none';
                document.body.appendChild(a);
                a.click();
                
                // MOBILE FIX: Because mobile browsers frequently block async auto-downloads, 
                // we MUST give the user a physical, clickable element in the DOM as a fallback.
                const fallbackDiv = document.createElement('div');
                fallbackDiv.style.cssText = "position:fixed; top:20px; left:50%; transform:translateX(-50%); background:#00ff66; color:#000; padding:15px 25px; border-radius:8px; z-index:99999; font-weight:bold; box-shadow:0 10px 30px rgba(0,0,0,0.5); text-align:center;";
                fallbackDiv.innerHTML = `Recording Ready!<br><a href="${u}" download="${filename}" style="color:#000; text-decoration:underline; font-size:1.2rem; display:block; margin-top:10px;">Tap here to Save</a><br><button onclick="this.parentElement.remove()" style="margin-top:10px; padding:5px 10px; background:#000; color:#fff; border:none; border-radius:4px;">Close</button>`;
                document.body.appendChild(fallbackDiv);
                
                // We CANNOT revoke the URL immediately anymore, otherwise the fallback link breaks!
                // It will be garbage collected when the page refreshes.
                logSystemMsg("Local recording ready. Check top of screen if download didn't start.");
            };
            
            mediaRecorder.onerror = (e) => {
                console.error("Recording error:", e);
                logSystemMsg("Recording interrupted due to an error.");
                stopRecordingEngine();
            };

            mediaRecorder.start();
            isRecording = true;
            r.classList.add('recording');
            
            // Auto-stop if user clicks "Stop Sharing" on the browser's native OS banner
            recordingStream.getVideoTracks()[0].onended = () => {
                if (isRecording) stopRecordingEngine();
            };
        } catch(e) {
            console.warn("Recording permission denied or failed:", e);
            logSystemMsg("Recording cancelled or permission denied.");
        }
    } else {
        stopRecordingEngine();
    } 
}

function stopRecordingEngine() {
    if(mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
    
    // Kill the stream tracks to turn off the browser's screen-sharing light!
    if (recordingStream) {
        recordingStream.getTracks().forEach(track => track.stop());
        recordingStream = null;
    }
    
    isRecording = false;
    const r = document.getElementById('recordBtn');
    if (r) r.classList.remove('recording');
}

// ==========================================
// 3. RELAY DATA CHANNELS (PRIORITY 5 & 6 REFACTOR)
// ==========================================
let currentReplyData = null; 
const bTypes = [
    'chat','draw','wb-clear','wb-bg','wb-text','wb-page','yt-load','yt-play','yt-pause',
    'media','iframe-load','cam-state','sc-load','sc-play','sc-pause','game-move','game-reset',
    'soundboard-play','ttt-state','ttt-seat','chess-move','chess-reset','timer-start','timer-stop',
    'poll-start','poll-vote','poll-results','pic-start','pic-win','file-meta','file-chunk',
    'cap','code-edit','md-edit','reaction','quiz-start','quiz-q','quiz-score','chess-seat'
];

// PRIORITY 6: Centralized Message Router (No Duplicates)
const dataChannelHandlers = {
    'rejected': (msg, conn) => { alert(msg.msg); leaveRoom(); },
    
    'hello': (msg, conn) => {
        if(!isHost) return;
        
        const existingMemberIndex = roomMembers.findIndex(x => x.userId === msg.userId);
        
        // STRICT CAPACITY ENFORCEMENT
        if (existingMemberIndex === -1 && window.currentMaxMembers && roomMembers.length >= window.currentMaxMembers) {
            conn.send(JSON.stringify({type: 'kicked'}));
            setTimeout(() => conn.close(), 500);
            return;
        }
        let safeName = msg.name;
        
        if (existingMemberIndex !== -1) {
            // Reconnection: preserve existing user name if available
            safeName = roomMembers[existingMemberIndex].name.split(" (")[0]; 
            const oldPeerId = roomMembers[existingMemberIndex].id;
            if (oldPeerId !== msg.peerId) {
                const oldWrapper = document.getElementById('wrapper-' + oldPeerId);
                if (oldWrapper) oldWrapper.remove();
                if (outgoingMediaCalls[oldPeerId]) {
                    outgoingMediaCalls[oldPeerId].close();
                    delete outgoingMediaCalls[oldPeerId];
                }
            }
        }
        
        let count = 1;
        while(roomMembers.some(m => m.name === safeName && m.userId !== msg.userId)) {
            count++;
            safeName = msg.name + " (" + count + ")";
        }
        
        if (existingMemberIndex === -1) {
            roomMembers.push({id: msg.peerId, userId: msg.userId, name: safeName, isHost: false, handRaised: false});
        } else {
            roomMembers[existingMemberIndex].id = msg.peerId;
            roomMembers[existingMemberIndex].name = safeName;
        }

        updateMembersUI(); 
        broadcastData({type: 'members-update', list: roomMembers}); 
        
        let currentTime = 0;
        let currentState = 1;
        if (typeof currentYtVideoId !== 'undefined' && currentYtVideoId && typeof ytPlayer !== 'undefined' && typeof ytPlayer.getCurrentTime === 'function') {
            currentTime = ytPlayer.getCurrentTime();
            currentState = ytPlayer.getPlayerState();
        }
        
        const syncData = {
            type: 'room-sync',
            stage: currentActiveStage,
            camStates: window.peerCamStates,
            ytVid: typeof currentYtVideoId !== 'undefined' ? currentYtVideoId : null,
            ytTime: currentTime,
            ytState: currentState,
            magnetOn: window.magnetMode,
            chessFen: typeof chessGame !== 'undefined' ? chessGame.fen() : null,
            cw: typeof chessPlayerWhite !== 'undefined' ? chessPlayerWhite : null,
            cwn: typeof chessPlayerWhiteName !== 'undefined' ? chessPlayerWhiteName : "",
            cb: typeof chessPlayerBlack !== 'undefined' ? chessPlayerBlack : null,
            cbn: typeof chessPlayerBlackName !== 'undefined' ? chessPlayerBlackName : "",
           // PRIORITY 18: Compress late-joiner canvas data to bypass the 150KB packet limit
            wbData: (typeof canvas !== 'undefined' && canvas.width > 0) ? canvas.toDataURL('image/jpeg', 0.5) : null, 
            wbPage: typeof currentWbPage !== 'undefined' ? currentWbPage : 0
        };
        
        const targetConnection = connections.find(c => c.peer === msg.peerId);
        if (targetConnection) targetConnection.send(JSON.stringify(syncData));
    },

    'magnet-off': (msg, conn) => {
        if (!isHost) {
            window.isGuestMagnetized = false;
            if (document.getElementById('ytGuestShield')) document.getElementById('ytGuestShield').style.display = 'none';
            logSystemMsg("MAGNET OFF: You can now navigate freely.");
        }
    },

    'room-sync': (msg, conn) => {
        if (msg.camStates) {
            Object.assign(window.peerCamStates, msg.camStates);
        }
        if (msg.magnetOn && !isHost) {
            window.isGuestMagnetized = true;
            window.magnetizedStageId = msg.stage;
            if (msg.stage === 'youtubeLayer' && document.getElementById('ytGuestShield')) {
                document.getElementById('ytGuestShield').style.display = 'block';
            }
        }
        if (msg.stage) switchMainStage(msg.stage);
        
        // ISSUE 1 FIX: Instantly catch up to the Host's YouTube player state
        if (!isHost && msg.ytVid) {
            if (dataChannelHandlers['yt-load']) dataChannelHandlers['yt-load']({vidId: msg.ytVid}, conn);
            if (dataChannelHandlers['yt-master-sync']) dataChannelHandlers['yt-master-sync']({time: msg.ytTime, state: msg.ytState}, conn);
        }

        if (msg.wbData) {
            const img = new Image();
            img.onload = () => {
                if (typeof ctx !== 'undefined' && canvas) {
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                    ctx.drawImage(img, 0, 0);
                }
            };
            img.src = msg.wbData;
            if (msg.wbPage !== undefined) {
                currentWbPage = msg.wbPage;
                const pageUi = document.getElementById('wbPageIndicator');
                if (pageUi) pageUi.innerText = `Page ${currentWbPage + 1}`;
            }
        }

        if (msg.ytVid) {
            const isSameVideo = (typeof currentYtVideoId !== 'undefined' && currentYtVideoId === msg.ytVid);
            currentYtVideoId = msg.ytVid;
            let targetTime = msg.ytTime || 0;
            if (msg.ytState === 1) targetTime += 1.0; 

            const applyThumbnailKiller = (player) => {
                window.guestNeedsUnmute = true;
                player.mute();
                player.playVideo(); 
            };

            if (typeof YT !== 'undefined' && YT.Player && (typeof ytPlayer === 'undefined' || !ytPlayer.loadVideoById)) {
                ytPlayer = new YT.Player('ytPlayer', {
                    height: '100%', width: '100%', videoId: msg.ytVid,
                    playerVars: { 'autoplay': 1, 'controls': 1, 'mute': 1, 'start': Math.floor(targetTime) },
                    events: {
                        'onReady': e => applyThumbnailKiller(e.target),
                        'onStateChange': e => {
                            if (!isHost || !window.magnetMode) return;
                            let time = ytPlayer.getCurrentTime();
                            if(e.data == YT.PlayerState.PLAYING) broadcastData({type:'yt-play', time: time});
                            else if(e.data == YT.PlayerState.PAUSED || e.data == YT.PlayerState.BUFFERING) broadcastData({type:'yt-pause', time: time});
                        }
                    }
                });
            } else if (typeof ytPlayer !== 'undefined' && typeof ytPlayer.loadVideoById === 'function') {
                if (!isSameVideo) ytPlayer.loadVideoById(msg.ytVid, targetTime);
                applyThumbnailKiller(ytPlayer);
            }
        }
        
        if (msg.chessFen && typeof chessGame !== 'undefined') {
            chessGame.load(msg.chessFen);
            if (typeof visualBoard !== 'undefined' && visualBoard) visualBoard.position(msg.chessFen);
            if (msg.cw) applyChessSeat('w', msg.cw, msg.cwn);
            if (msg.cb) applyChessSeat('b', msg.cb, msg.cbn);
        }
    },

    'chess-seat': (msg, conn) => applyChessSeat(msg.color, msg.peerId, msg.name),
    
    'yt-load': (msg, conn) => {
        currentYtVideoId = msg.vidId;
        switchMainStage('youtubeLayer'); 
        
        const waitForYt = (retries = 10) => {
            if (typeof ytPlayer !== 'undefined' && typeof ytPlayer.loadVideoById === 'function') {
                ytPlayer.loadVideoById(msg.vidId);
            } else if (retries > 0) {
                setTimeout(() => waitForYt(retries - 1), 500);
            } else {
                console.warn("YouTube player failed to initialize.");
            }
        };
        waitForYt();
    },

    'hand-toggle': (msg, conn) => {
        if(isHost) { 
            let m = roomMembers.find(x => x.id === msg.peerId); 
            if(m) m.handRaised = msg.state; 
            updateMembersUI(); 
            broadcastData({type: 'members-update', list: roomMembers}); 
        }
    },

    'hand-ack': (msg, conn) => {
        myHandRaised = false; 
        if (document.getElementById('handBtn')) document.getElementById('handBtn').classList.remove('hand-raised'); 
    },

    'members-update': (msg, conn) => {
        roomMembers = msg.list; 
        updateMembersUI(); 
        
        // PRIORITY 1: GARBAGE COLLECT GHOST WRAPPERS
        // Find all video wrappers currently on screen
        const allWrappers = document.querySelectorAll('.video-wrapper');
        allWrappers.forEach(w => {
            const wid = w.id;
            // Ignore the local video wrapper and the host's default wrapper if applicable
            if (wid === 'wrapper-local' || wid === 'wrapper-host') return;
            
            // Extract the peerId from 'wrapper-[peerId]'
            const wPeerId = wid.replace('wrapper-', '');
            
            // If this wrapper's peerId is NO LONGER in roomMembers, DESTROY IT.
            const stillExists = roomMembers.find(m => m.id === wPeerId);
            if (!stillExists && wPeerId !== currentRoomHostId) {
                if (typeof activeVisualizers !== 'undefined' && activeVisualizers[wid]) cancelAnimationFrame(activeVisualizers[wid]);
                w.remove();
                if (outgoingMediaCalls[wPeerId]) {
                    outgoingMediaCalls[wPeerId].close();
                    delete outgoingMediaCalls[wPeerId];
                }
            }
        });

        if (!isHost) {
            roomMembers.forEach(m => {
                if (m.id !== peer.id && !m.isHost && peer.id > m.id) {
                    const wid = 'wrapper-' + m.id;
                    if (!document.getElementById(wid) && !outgoingMediaCalls[m.id]) {
                        const call = peer.call(m.id, getSafeStream());
                        outgoingMediaCalls[call.peer] = call;
                        call.on('stream', rs => {
                            if(!document.getElementById(wid)) {
                                const w = document.createElement('div'); 
                                w.id = wid; 
                                const isOff = window.peerCamStates[call.peer] === false;
                                w.className = isOff ? 'video-wrapper video-off' : 'video-wrapper';
                                const v = document.createElement('video'); 
                                v.id = call.peer; v.autoplay = true; v.playsInline = true; v.setAttribute('playsinline', 'true');; v.srcObject = rs; v.onloadedmetadata = () => v.play().catch(e => console.warn('Autoplay blocked:', e));
                                w.innerHTML = `<div class="video-avatar"><div class="voice-pulse pulse-anim"><i class="fas fa-microphone"></i></div></div>`; 
                                w.appendChild(v);
                                document.getElementById('videoLayer').appendChild(w); 
                                setupAudioVisualizer(rs, wid, true); 
                            }
                        });
                        call.on('close', () => { document.getElementById(wid)?.remove(); delete outgoingMediaCalls[call.peer]; });
                    }
                }
            });
        }
    },

    'request-cam-on': (msg, conn) => { if (msg.targetId === peer.id) document.getElementById('camRequestModal').style.display = 'flex'; },
    
    'hardware-lock-state': (msg, conn) => { 
        if (typeof msg.state !== 'boolean') return; // PRIORITY 7: Strict Type Validation
        if (msg.targetId === peer.id || msg.targetId === 'all') { isHardwareLocked = msg.state; if (isHardwareLocked) { document.getElementById('micBtn')?.classList.contains('active') && document.getElementById('micBtn').click(); document.getElementById('camBtn')?.classList.contains('active') && document.getElementById('camBtn').click(); logSystemMsg("Your hardware has been locked by the Host."); } else { logSystemMsg("Your hardware has been unlocked by the Host."); } } 
    },

    'breakout': (msg, conn) => {
        document.getElementById('lobbyJoinId').value = msg.nr; 
        document.getElementById('returnMainRoomBtn').style.display = 'inline-block'; 
        document.getElementById('returnMainRoomBtn').dataset.main = msg.mr; 
        leaveRoom(); 
        setTimeout(joinRoom, 1000); 
    },

   'cam-state': (msg, conn) => { 
        if (typeof msg.state !== 'boolean') return; // PRIORITY 7: Strict Type Validation
        const w = document.getElementById('wrapper-' + msg.peerId); 
        if(w) msg.state ? w.classList.remove('video-off') : w.classList.add('video-off'); 
    },

    // --- CONSOLIDATED HOST CONTROLS ---
    'force-mute-all': (msg, conn) => {
        const micBtn = document.getElementById('micBtn');
        if (micBtn && micBtn.classList.contains('active')) micBtn.click();
        logSystemMsg("The Host has muted everyone.");
    },

    'force-cam-off-all': (msg, conn) => {
        const camBtn = document.getElementById('camBtn');
        if (camBtn && camBtn.classList.contains('active')) camBtn.click();
        logSystemMsg("The Host has turned off all cameras.");
    },

    'spotlight': (msg, conn) => {
        applySpotlight(msg.targetId); 
        if (!isHost) applyVideoQuality(msg.targetId === peer.id);
    },

    // Consolidate 'force-mute' and 'force-mute-user' into a single source of truth
    'force-mute': (msg, conn) => {
        const micBtn = document.getElementById('micBtn');
        if (micBtn && micBtn.classList.contains('active')) {
            micBtn.click();
            logSystemMsg("The Host has muted your microphone.");
        }
    },
    'force-mute-user': (msg, conn) => { if (msg.targetId === peer.id) dataChannelHandlers['force-mute'](msg, conn); },

    // Consolidate 'force-cam-off' and 'force-cam-off-user'
    'force-cam-off': (msg, conn) => {
        const camBtn = document.getElementById('camBtn');
        if (camBtn && camBtn.classList.contains('active')) {
            camBtn.click();
            logSystemMsg("The Host has turned off your camera.");
        }
    },
    'force-cam-off-user': (msg, conn) => { if (msg.targetId === peer.id) dataChannelHandlers['force-cam-off'](msg, conn); },

    'kick-user': (msg, conn) => {
        if (msg.targetId === peer.id) {
            alert("You have been removed from the session by the Host.");
            leaveRoom();
        }
    },
    'kicked': (msg, conn) => { 
        leaveRoom(); 
        setTimeout(() => alert("Connection rejected: Space capacity reached or you were kicked."), 100);
    },

    // --- APPS & CHATS ---
    'reaction': (msg, conn) => showReactionUI(msg.peerId, msg.emoji),
    'cap': (msg, conn) => showCaption(msg.n, msg.t),
    'chat': (msg, conn) => renderChatMessage(msg.text, 'them', msg.senderName, msg.replyData),
    'code-edit': (msg, conn) => { if(typeof myCodeEditor !== 'undefined' && myCodeEditor && myCodeEditor.getValue() !== msg.code) { const c = myCodeEditor.getCursor(); myCodeEditor.setValue(msg.code); myCodeEditor.setCursor(c); } },
    'md-edit': (msg, conn) => { document.getElementById('mdInput').value = msg.text; renderMarkdown(); },

    // --- WHITEBOARD ---
    'draw': (msg, conn) => handleIncomingDraw(msg),
    'wb-clear': (msg, conn) => clearWhiteboard(false),
    'wb-bg': (msg, conn) => applyBoardBg(msg.color),
    'wb-bg-img': (msg, conn) => { const i = new Image(); i.onload = () => ctx.drawImage(i, 0, 0); i.src = msg.data; },
    'wb-page': (msg, conn) => { wbPages[msg.page] = msg.data; currentWbPage = msg.page; renderCurrentPage(); },
    'wb-text': (msg, conn) => drawWbText(msg.text, msg.x, msg.y, false, msg.color, msg.font, msg.size),

    // QUIZ, POLLS, FILES
    'quiz-start': (msg, conn) => { if (!isHost && conn.peer !== currentRoomHostId) return; switchSidebarTab('polls'); switchMainStage('quizLayer'); document.getElementById('quizDisplay').innerHTML = `<h1 class="serif-text" style="color:var(--accent); font-size:3rem; margin-bottom:20px;">Assessment Commencing</h1>`; },
    'quiz-q': (msg, conn) => { if (!isHost && conn.peer !== currentRoomHostId) return; renderQuizQuestion(msg.q, msg.opts); },
    
    // PRIORITY 17: Use unforgeable conn.peer instead of trusting the msg object
    'quiz-ans': (msg, conn) => { if(isHost && typeof handleQuizAnswer === 'function') handleQuizAnswer(conn.peer, msg.ansIdx); },
    'quiz-score': (msg, conn) => { if (!isHost && conn.peer !== currentRoomHostId) return; renderQuizLeaderboard(msg.scores); },
    'poll-start': (msg, conn) => { if (!isHost && conn.peer !== currentRoomHostId) return; renderActivePoll(msg.question, msg.options, msg.votes); switchSidebarTab('polls'); },
    
    // PRIORITY 17: Secure poll votes against duplicate submissions and invalid options
    'poll-vote': (msg, conn) => { 
        if(isHost) { 
            if (activePollVoters.has(conn.peer) || typeof msg.index !== 'number' || msg.index < 0 || msg.index >= activePollOptions.length) return;
            activePollVoters.add(conn.peer);
            activePollVotes[msg.index]++; 
            broadcastData({type: 'poll-results', votes: activePollVotes}); 
            renderActivePoll(activePollQuestion, activePollOptions, activePollVotes); 
        } 
    },
    'poll-results': (msg, conn) => renderActivePoll(activePollQuestion, activePollOptions, msg.votes),

    // --- FILES & TIMERS ---
    'pic-start': (msg, conn) => handlePicStart(msg.drawer, msg.word),
    'pic-win': (msg, conn) => handlePicWin(msg.winner, msg.word),
    'file-meta': (msg, conn) => initReceiveFile(msg.name, msg.mime, msg.total),
    'file-chunk': (msg, conn) => receiveFileChunk(msg.index, msg.data),
    'file-cancel': (msg, conn) => { document.getElementById('globalFileProgressWrapper').style.display = 'none'; logSystemMsg("Sender cancelled the file transfer."); rxFileChunks = []; },
    'timer-start': (msg, conn) => executeTimer(msg.endTime),
    'timer-stop': (msg, conn) => { clearInterval(timerInterval); document.getElementById('sharedTimerDisplay').style.display = 'none'; },

    // --- YT MASTER SYNC ---
    'yt-master-sync': (msg, conn) => { if (!isHost && conn.peer !== currentRoomHostId) return;
        if (isHost || !window.isGuestMagnetized || typeof ytPlayer === 'undefined' || typeof ytPlayer.getCurrentTime !== 'function') return;
        let targetState = msg.state;
        let targetVid = msg.vidId || currentYtVideoId;
        let myTime = ytPlayer.getCurrentTime() || 0;
        let myState = ytPlayer.getPlayerState();

        if (typeof currentYtVideoId !== 'undefined' && currentYtVideoId !== targetVid) {
            currentYtVideoId = targetVid;
            switchMainStage('youtubeLayer');
            ytPlayer.mute(); window.guestNeedsUnmute = true;
            ytPlayer.loadVideoById(targetVid, msg.time || 0);
            return; 
        }
        if (myState === -1 || myState === 5) { ytPlayer.mute(); window.guestNeedsUnmute = true; ytPlayer.playVideo(); return; }
        if (myState === 3) return; 

        if (targetState === 1) {
            if (myState !== 1) ytPlayer.playVideo();
            if (window.guestNeedsUnmute && myState === 1) {
                setTimeout(() => { if (typeof ytPlayer.unMute === 'function') ytPlayer.unMute(); }, 200);
                window.guestNeedsUnmute = false;
            }
        }
        else if (targetState === 2 && myState !== 2) ytPlayer.pauseVideo();
        else if (targetState === 3 && myState === 1) ytPlayer.pauseVideo();

        if (targetState === 1 && Math.abs(myTime - msg.time) > 1.0) ytPlayer.seekTo(msg.time, true);
        else if (targetState === 2 && Math.abs(myTime - msg.time) > 0.3) ytPlayer.seekTo(msg.time, true);
    },
    'yt-play': (msg, conn) => dataChannelHandlers['yt-master-sync']({...msg, state: 1}, conn),
    'yt-pause': (msg, conn) => dataChannelHandlers['yt-master-sync']({...msg, state: 2}, conn),
    'yt-heartbeat': (msg, conn) => dataChannelHandlers['yt-master-sync'](msg, conn),

    // --- OTHER MEDIA & GAMES ---
    // Removed TTT handlers
    'chess-move': (msg, conn) => { performChessMove(msg.from, msg.to, false); switchMainStage('gameLayer'); },
    'chess-reset': (msg, conn) => { resetChess(false); switchMainStage('gameLayer'); },
    'chess-reset': (msg, conn) => { resetChess(false); switchMainStage('gameLayer'); },
    'soundboard-play': (msg, conn) => { if(typeof playBoardSound === 'function') playBoardSound(msg.sound, false); },
    'media': (msg, conn) => renderSharedMedia(msg.dataUrl, msg.mimeType, msg.fileName),
    'iframe-load': (msg, conn) => loadSharedBrowser(msg.url, false)
};

function setupDataChannelHandlers(conn) {
    conn.on('data', data => {
       let msg;
        // --- PRIORITY 7: STRICT DATA VALIDATION & PARSING ---
        
        // 1. Block Oversized Payloads (Prevents Memory Exhaustion / DoS crashes)
        // File chunks are capped at 50KB. Anything over 150KB is rejected.
        if (typeof data === 'string' && data.length > 150000) {
            console.warn("SECURITY BLOCK: Payload exceeded 150KB limit.");
            return; 
        }

        // 2. Safe JSON Parsing
        try {
            msg = JSON.parse(data);
            
            // 3. Structural Validation (Must be an object, not null, not an array)
            if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return;
            
            // 4. Type Validation (Must have a valid string type)
            if (typeof msg.type !== 'string' || msg.type.trim() === '') return;
            
            // 5. String ID Validation (Prevents object injection via IDs)
            if (msg.targetId && typeof msg.targetId !== 'string') return;
            if (msg.peerId && typeof msg.peerId !== 'string') return;
            if (msg.senderId && typeof msg.senderId !== 'string') return;
            
        } catch (err) {
            console.warn("SECURITY BLOCK: Malformed JSON dropped.");
            return;
        }

        // SECURITY FIX (PRIORITY 5): Host Authorization Validator
        const privilegedTypes = [
            'force-mute-all', 'force-cam-off-all', 'spotlight', 'force-mute', 'force-mute-user', 
            'force-cam-off', 'force-cam-off-user', 'kick-user', 'hardware-lock-state', 
            'game-reset', 'c4-reset', 'chess-reset', 'yt-master-sync', 'magnet-off', 'breakout',
            'timer-start', 'timer-stop', 'quiz-start', 'quiz-q', 'poll-start', 'request-cam-on'
        ];
        
        if (privilegedTypes.includes(msg.type)) {
            const hostMember = roomMembers.find(m => m.isHost);
            // Drop forged commands originating from anyone except the actual Host
            if (!hostMember || conn.peer !== hostMember.id) {
                console.warn(`Unauthorized privileged action (${msg.type}) attempted by ${conn.peer}`);
                return; 
            }
        }
        
        // --- PRIORITY 8: HOST GAME VALIDATOR ---
        if (isHost) {
            if (['game-reset', 'c4-reset', 'chess-reset'].includes(msg.type)) {
                logSystemMsg("Blocked an unauthorized game reset attempt.");
                return; 
            }

            if (['game-move', 'c4-move', 'chess-move'].includes(msg.type)) {
                if (msg.type === 'game-move') {
                    if (tttBoard[msg.index] !== null) return; 
                    if (tttP === 'X' && window.tttPlayerX && window.tttPlayerX !== conn.peer) return;
                    if (tttP === 'O' && window.tttPlayerO && window.tttPlayerO !== conn.peer) return;
                    if (tttP === 'X' && !window.tttPlayerX) window.tttPlayerX = conn.peer;
                    if (tttP === 'O' && !window.tttPlayerO) window.tttPlayerO = conn.peer;
                }
                else if (msg.type === 'c4-move') {
                    if (c4Grid[0][msg.col] !== null) return; 
                    if (c4Turn === 'R' && window.c4PlayerR && window.c4PlayerR !== conn.peer) return;
                    if (c4Turn === 'Y' && window.c4PlayerY && window.c4PlayerY !== conn.peer) return;
                    if (c4Turn === 'R' && !window.c4PlayerR) window.c4PlayerR = conn.peer;
                    if (c4Turn === 'Y' && !window.c4PlayerY) window.c4PlayerY = conn.peer;
                }
                else if (msg.type === 'chess-move') {
                    if (typeof chessGame === 'undefined' || chessGame.game_over()) return;
                    const isWhiteTurn = chessGame.turn() === 'w';
                    const expectedPeer = isWhiteTurn ? chessPlayerWhite : chessPlayerBlack;
                    if (expectedPeer && conn.peer !== expectedPeer) return; 
                    
                    const tempGame = new Chess(chessGame.fen());
                    if (!tempGame.move({from: msg.from, to: msg.to, promotion: 'q'})) return; 
                }
            }
        }

        // Host Relays the message to other clients
        if (isHost && bTypes.includes(msg.type)) {
            connections.forEach(c => { 
                if(c.peer !== conn.peer && c.open) c.send(data); 
            });
        }
        
        // PRIORITY 6: Route the message safely using the clean handler map
        if (dataChannelHandlers[msg.type]) {
            dataChannelHandlers[msg.type](msg, conn);
        } else {
            console.warn("Unknown or unsupported message type received: " + msg.type);
        }
    });
}

function broadcastData(obj) { 
    const p = JSON.stringify(obj); 
    connections.forEach(c => { if(c.open) c.send(p); }); 
}

// Chat + Pictionary
let pictionaryActive = false; 
let pictionaryWord = "";

document.getElementById('sendBtn').onclick = sendChatMsg; 
document.getElementById('msgInput').addEventListener('keypress', e => { if(e.key === 'Enter') sendChatMsg(); });

function sendChatMsg() {
    // PRIORITY 29: Limit chat payload to 500 characters max
    const rawText = document.getElementById('msgInput').value;
    const v = rawText.trim().substring(0, 500);
    
    if(v) {
        if(pictionaryActive && v.toLowerCase() === pictionaryWord.toLowerCase()) { 
            broadcastData({type: 'pic-win', winner: myDisplayName, word: pictionaryWord}); 
            handlePicWin(myDisplayName, pictionaryWord); 
            document.getElementById('msgInput').value = ''; 
            return; 
        }
        broadcastData({type: 'chat', text: v, replyData: currentReplyData, senderName: myDisplayName}); 
        renderChatMessage(v, 'you', myDisplayName, currentReplyData); 
        document.getElementById('msgInput').value = ''; 
        cancelReply();
    }
}

function renderChatMessage(t, s, n, r) {
    const b = document.getElementById('chatBox'); 
    
    const wrapper = document.createElement('div');
    wrapper.className = `msg-wrapper ${s}`;
    
    const msgDiv = document.createElement('div');
    msgDiv.className = `msg ${s}`;
    
    // PRIORITY 20: Add missing Timestamps & ensure safe name rendering
    const timeStr = new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    const nameDiv = document.createElement('div');
    nameDiv.style.cssText = "font-size:0.65rem; color:var(--accent); letter-spacing:1px; margin-bottom:5px; text-transform:uppercase;";
    nameDiv.textContent = `${n} • ${timeStr}`; 
    msgDiv.appendChild(nameDiv);
    
    if (r) {
        const replyDiv = document.createElement('div');
        replyDiv.className = 'quoted-reply';
        const repSender = document.createElement('div');
        repSender.className = 'quoted-sender';
        repSender.textContent = r.sender;
        const repText = document.createElement('div');
        repText.textContent = r.text;
        replyDiv.appendChild(repSender);
        replyDiv.appendChild(repText);
        msgDiv.appendChild(replyDiv);
    }
    
    // PRIORITY 20: Strict DOMPurify config to prevent malicious tag injection
    const cleanText = window.DOMPurify ? DOMPurify.sanitize(t, { ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'a'], ALLOWED_ATTR: ['href', 'target', 'rel'] }) : t;
    const textDiv = document.createElement('div');
    textDiv.innerHTML = cleanText.replace(/(https?:\/\/[^\s]+)/g,'<a href="$1" target="_blank" rel="noopener noreferrer" style="color:var(--accent); text-decoration:none;">$1</a>');
    msgDiv.appendChild(textDiv);
    wrapper.appendChild(msgDiv);
    
    const btn = document.createElement('div');
    btn.className = 'reply-btn';
    btn.style.cssText = "cursor:pointer; color:#666; font-size:0.8rem; margin:0 5px; transition:0.3s;";
    btn.innerHTML = '<i class="fas fa-reply"></i>';
    
    btn.addEventListener('click', () => {
        initiateReply(n, textDiv.textContent); // Only quote safe plaintext, no HTML
    });
    
    wrapper.appendChild(btn);
    b.appendChild(wrapper);
    b.scrollTop = b.scrollHeight;
}

function initiateReply(s, t) { 
    currentReplyData = {sender: s, text: t}; 
    document.getElementById('replySender').innerText = `Reply to ${s}`; 
    document.getElementById('replyText').innerText = t; 
    document.getElementById('replyPreview').style.display = 'block'; 
    document.getElementById('msgInput').focus(); 
}

function cancelReply() { 
    currentReplyData = null; 
    document.getElementById('replyPreview').style.display = 'none'; 
}

// Speech to Text
let recognition;
function toggleCaptions() {
    if(recognition) { 
        recognition.stop(); 
        recognition = null; 
        logSystemMsg("Live Transcription Terminated."); 
        return; 
    }
    
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition; 
    if(!SR) return alert("Browser does not support Speech API.");
    
    recognition = new SR(); 
    recognition.continuous = true; 
    recognition.interimResults = true;
    
    recognition.onresult = (e) => { 
        let txt = ''; 
        for(let i = e.resultIndex; i < e.results.length; i++) { 
            txt += e.results[i][0].transcript; 
        } 
        if(txt.trim()) { 
            broadcastData({type: 'cap', n: myDisplayName, t: txt}); 
            showCaption(myDisplayName, txt); 
        } 
    };
    recognition.start(); 
    logSystemMsg("Live Transcription Active.");
}

function showCaption(n, t) { 
    const c = document.getElementById('liveCaptions'); 
    c.style.display = 'block'; 
    c.innerText = `${n}: ${t}`; 
    clearTimeout(c.timeout); 
    c.timeout = setTimeout(() => c.style.display = 'none', 4000); 
}

// ==========================================
// HOST CONTROLS ENGINE
// ==========================================
function hostAction(actionType) {
    if (!isHost) return;
    broadcastData({ type: actionType });
    logSystemMsg(`Host executed: ${actionType.replace('-', ' ')}`);
}

function kickMember(targetId) {
    if (!isHost) return;
    
    // 1. Kick them from the WebRTC mesh
    broadcastData({ type: 'kick-user', targetId: targetId });
    connections.find(x => x.peer === targetId)?.send(JSON.stringify({type: 'kicked'})); 
    
    // 2. Remove them from the Host's UI and Arrays
    roomMembers = roomMembers.filter(x => x.id !== targetId); 
    updateMembersUI(); 
    
    // 3. Sync the updated list to remaining guests
    broadcastData({type: 'members-update', list: roomMembers}); 
    logSystemMsg(`Booting user: ${targetId}`);
}

function muteMember(targetId) { 
    if (!isHost) return; 
    broadcastData({ type: 'force-mute-user', targetId: targetId }); 
    connections.find(x => x.peer === targetId)?.send(JSON.stringify({type: 'force-mute'})); 
    logSystemMsg(`Muting user: ${targetId}`); 
}

// ==========================================
// HOST OVERRIDE (PULL AUDIENCE)
// ==========================================
window.magnetMode = false;

function forceSyncStage() {
    if (!isHost) return;
    window.magnetMode = !window.magnetMode; // Toggle ON/OFF
    
    if (window.magnetMode) {
        let currentTime = 0, currentState = 1;
        if (currentYtVideoId && typeof ytPlayer !== 'undefined' && typeof ytPlayer.getCurrentTime === 'function') {
            currentTime = ytPlayer.getCurrentTime();
            currentState = ytPlayer.getPlayerState();
        }
        
       broadcastData({
            type: 'room-sync',
            stage: currentActiveStage,
            ytVid: currentYtVideoId,
            ytTime: currentTime,
            ytState: currentState,
            magnetOn: true
        });
        
        // PRIORITY 30: Private Whiteboarding - Sync canvas image when Magnet Mode is enabled
        if (currentActiveStage === 'whiteboardLayer' && typeof canvas !== 'undefined' && canvas.width > 0) {
            broadcastData({type: 'wb-bg-img', data: canvas.toDataURL('image/jpeg', 0.5)});
        }
        
        // Issue 1 Fix: `room-sync` instantly synchronizes the guests, no arbitrary delay needed.
        
        if (typeof playBoardSound === 'function') playBoardSound('chime', false);
        logSystemMsg("MAGNET ON: Guests locked to your screen.");
    } else {
        broadcastData({ type: 'magnet-off' });
        if (typeof playBoardSound === 'function') playBoardSound('chime', false);
        logSystemMsg("MAGNET OFF: Guests can navigate freely.");
    }
}

// ==========================================
// SPOTLIGHT VIDEO SYSTEM
// ==========================================
let currentSpotlightId = null;

function triggerSpotlight(targetId) {
    if (!isHost) return;
    
    // Toggle off if clicking the same person twice
    if (currentSpotlightId === targetId) {
        targetId = null; 
    }
    
    applySpotlight(targetId);
    broadcastData({ type: 'spotlight', targetId: targetId });
    
    if (targetId) logSystemMsg(`Host spotlighted a participant.`);
    else logSystemMsg(`Spotlight removed.`);
}

function applySpotlight(targetId) {
    currentSpotlightId = targetId;
    
    // 1. Remove spotlight styling from everyone first
    document.querySelectorAll('.video-wrapper').forEach(w => {
        w.classList.remove('spotlighted');
        const badge = w.querySelector('.spotlight-badge');
        if(badge) badge.remove();
    });
    
    // 2. Apply it to the new target
    if (targetId) {
        const wid = targetId === peer.id ? 'wrapper-local' : 'wrapper-' + targetId;
        const w = document.getElementById(wid);
        
        if (w) {
            w.classList.add('spotlighted');
            const badge = document.createElement('div');
            badge.className = 'spotlight-badge';
            badge.innerHTML = '<i class="fas fa-thumbtack"></i> Spotlight';
            w.appendChild(badge);
        }
    }
}
// ==========================================
// SMART PiP (PICTURE-IN-PICTURE) ENGINE
// ==========================================
setInterval(() => {
    const wrappers = document.querySelectorAll('.video-wrapper');
    
    // If we are on the main video stage, make sure everyone is visible
    if (currentActiveStage === 'videoLayer') {
        wrappers.forEach(w => w.classList.remove('pip-hidden'));
        return;
    }
    
    // If we are in an App (Whiteboard, Code, etc.), run the Smart Filter
    wrappers.forEach(w => {
        // Always show yourself, the host, the spotlighted person, and active speakers
        const isMe = w.id === 'wrapper-local';
        const isSpotlighted = w.classList.contains('spotlighted');
        const isSpeaking = w.classList.contains('speaker-active');
        
        let isHostUser = false;
        if (!isMe) {
            const peerId = w.id.replace('wrapper-', '');
            const memberRecord = roomMembers.find(m => m.id === peerId);
            if (memberRecord && memberRecord.isHost) isHostUser = true;
        } else if (isHost) {
            isHostUser = true;
        }

        if (isMe || isSpotlighted || isSpeaking || isHostUser) {
            w.classList.remove('pip-hidden');
        } else {
            w.classList.add('pip-hidden');
        }
    });
}, 1000);
function muteAll() {
    if (!isHost) return;
    broadcastData({ type: 'force-mute-all' });
    logSystemMsg("Forced all participant microphones off.");
}

function camsOffAll() {
    if (!isHost) return;
    broadcastData({ type: 'force-cam-off-all' });
    logSystemMsg("Forced all participant cameras off.");
}
window.addEventListener('load', () => {
    if (window.location.hash) {
        const inviteCode = window.location.hash.substring(1).toUpperCase();
        if (inviteCode.length === 5) {
            document.getElementById('lobbyJoinId').value = inviteCode;
            setTimeout(joinRoom, 1500); 
        }
    }
});
// ==========================================
// PRIORITY 11: SMART BANDWIDTH & QUALITY MANAGER
// ==========================================
async function applyVideoQuality(forceHD) {
    if (!localStream) return;
    const videoTrack = localStream.getVideoTracks()[0];
    if (!videoTrack) return;

    if (window.currentVideoIsHD === forceHD) return; 
    window.currentVideoIsHD = forceHD;

    try {
        if (forceHD) {
            await videoTrack.applyConstraints({ width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } });
            logSystemMsg("Webcam upgraded to High Definition.");
        } else {
            await videoTrack.applyConstraints({ width: { ideal: 320 }, height: { ideal: 240 }, frameRate: { ideal: 15 } });
            logSystemMsg("Webcam downgraded to Eco-Mode to save bandwidth.");
        }
    } catch (err) {
        console.warn("Could not apply hardware resolution constraints:", err);
    }
}

// Automatic Mesh Scalability & CPU Load Management
setInterval(() => {
    // Only run if the user is actively in a WebRTC session with an active camera
    if (!localStream || !peer || !peer.open || typeof roomMembers === 'undefined') return;
    
    // 1. EXEMPTIONS: Never automatically downgrade the Host or the currently Spotlighted user
    if (isHost || (typeof currentSpotlightId !== 'undefined' && currentSpotlightId === peer.id)) {
        applyVideoQuality(true);
        return;
    }

    // 2. HEAVY LOAD DETECTORS: Calculate the strain on the client's CPU and Network
    const isCrowdedMesh = roomMembers.length >= 4; 
    const isSharingScreen = typeof currentActiveStage !== 'undefined' && currentActiveStage === 'screenLayer';
    const isHeavyCPU = typeof isRecording !== 'undefined' && isRecording;
    
    // 3. MOBILE DETECTOR: Strict bandwidth conservation for phones
    const isMobile = window.innerWidth <= 850;

    // 4. THE DECISION ENGINE
    if (roomMembers.length >= 8 && !isHost) {
        // AUDIO-ONLY FALLBACK: Extreme load prevention
        if (localStream.getVideoTracks().length > 0) {
            localStream.getVideoTracks()[0].enabled = false;
            document.getElementById('localVideo').classList.add('video-off');
            logSystemMsg("Server capacity reached. Camera temporarily paused to save bandwidth.");
        }
    } else if (isCrowdedMesh || isSharingScreen || isHeavyCPU || isMobile) {
        applyVideoQuality(false); // Force Eco-Mode to prevent browser crash/lag
    } else {
        applyVideoQuality(true);  // Safe to use HD for intimate 1-on-1 desktop calls
    }
}, 15000); // Evaluates the room conditions every 15 seconds
// ==========================================
// PRIORITY 24: BROWSER TAB CLOSE FAILSAFE
// ==========================================
window.addEventListener('beforeunload', () => {
    // If the Host force-closes their browser tab, explicitly wipe the room from Firebase
    if (isHost && peer && peer.id) {
        db.ref('rooms/' + peer.id).remove();
    }
    // Attempt a synchronous cleanup of hardware tracks
    if (localStream) {
        localStream.getTracks().forEach(t => t.stop());
    }
});





// ==========================================






// 8. GAMES (CHESS PRO, TTT, C4)
// Removed selectGame since only chess remains

let chessGame = new Chess();
let visualBoard = null;
let chessPlayerWhite = null;
let chessPlayerWhiteName = "";
let chessPlayerBlack = null;
let chessPlayerBlackName = "";

function takeChessSeat(color) {
    broadcastData({type: 'chess-seat', color: color, peerId: peer.id, name: myDisplayName});
    applyChessSeat(color, peer.id, myDisplayName);
}

function applyChessSeat(color, pId, pName) {
    if (color === 'w') {
        chessPlayerWhite = pId;
        chessPlayerWhiteName = pName;
        const btn = document.getElementById('btnSitWhite');
        if(btn) { btn.innerText = "White: " + pName; btn.disabled = true; btn.style.borderColor = 'var(--accent)'; }
        if (pId === peer.id && visualBoard) visualBoard.orientation('white');
    } else {
        chessPlayerBlack = pId;
        chessPlayerBlackName = pName;
        const btn = document.getElementById('btnSitBlack');
        if(btn) { btn.innerText = "Black: " + pName; btn.disabled = true; btn.style.borderColor = 'var(--accent)'; }
        if (pId === peer.id && visualBoard) visualBoard.orientation('black');
    }
}

function initChess() {
    if (visualBoard) visualBoard.destroy();
    
    const config = {
        draggable: true,
        position: chessGame.fen(),
        pieceTheme: 'https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png',
        onDragStart: function(source, piece, position, orientation) {
            // FIX: Enforce Seat Locks (Block unauthorized users)
            if (piece.search(/^w/) !== -1 && peer.id !== chessPlayerWhite) return false;
            if (piece.search(/^b/) !== -1 && peer.id !== chessPlayerBlack) return false;

            if (chessGame.game_over() || 
                (chessGame.turn() === 'w' && piece.search(/^b/) !== -1) ||
                (chessGame.turn() === 'b' && piece.search(/^w/) !== -1)) {
                return false;
            }
        },
     onDrop: function(source, target) {
            // PRIORITY 16: Guests cannot execute moves locally. They must ask the Host.
            if (!isHost) {
                broadcastData({type: 'chess-move', from: source, to: target});
                return 'snapback'; // Instantly snaps back until the Host confirms the move!
            }

            // Host validates and executes instantly
            let move = chessGame.move({ from: source, to: target, promotion: 'q' });
            if (move === null) return 'snapback';
            
            broadcastData({type: 'chess-move', from: source, to: target});
            if(chessGame.in_checkmate()) logSystemMsg("Chess Match Concluded: Checkmate"); 
        },
        onSnapEnd: function() {
            visualBoard.position(chessGame.fen());
        }
    };
    
    visualBoard = Chessboard('chessBoard', config);
}

function performChessMove(f, t, isSender) { 
    let move = chessGame.move({from: f, to: t, promotion: 'q'}); 
    if(!move) return; 
    if (visualBoard) visualBoard.position(chessGame.fen());
    if(chessGame.in_checkmate()) logSystemMsg("Chess Match Concluded: Checkmate"); 
}

function resetChess(broadcast) { 
    if (broadcast && !isHost) return alert("Only the Host can restart the match.");
    chessGame = new Chess(); 
    if (visualBoard) {
        visualBoard.start();
        visualBoard.orientation('white');
    }
    
    // Clear the seats
    chessPlayerWhite = null;
    chessPlayerWhiteName = "";
    chessPlayerBlack = null;
    chessPlayerBlackName = "";
    
    const btnW = document.getElementById('btnSitWhite');
    if(btnW) { btnW.innerText = "Sit White"; btnW.disabled = false; btnW.style.borderColor = ''; }
    
    const btnB = document.getElementById('btnSitBlack');
    if(btnB) { btnB.innerText = "Sit Black"; btnB.disabled = false; btnB.style.borderColor = ''; }

    if(broadcast) broadcastData({type: 'chess-reset'}); 
}
// Removed Tic-Tac-Toe logic
// ==========================================
// 9. FIXED WHITEBOARD, ALL BRUSHES, PICTIONARY
// ==========================================
const canvas = document.getElementById('whiteboard'); 
const ctx = canvas.getContext('2d');
let isDrawing = false, lastX = 0, lastY = 0; 
let currentWbTool = 'pen'; 
let currentStampImg = null;
let wbPages = ['']; 
let currentWbPage = 0;

function setWbTool(t, b) { 
    currentWbTool = t; 
    document.querySelectorAll('.wb-btn').forEach(x => x.classList.remove('active')); 
    if(b) b.classList.add('active'); 
    canvas.style.cursor = 'crosshair'; 
}

function changeWbBg(t) { 
    if(t === 'grid') { 
        ctx.fillStyle = '#111'; ctx.fillRect(0,0,canvas.width,canvas.height); 
        ctx.beginPath(); ctx.strokeStyle = '#222'; 
        for(let x=0; x<canvas.width; x+=40) { ctx.moveTo(x,0); ctx.lineTo(x,canvas.height); } 
        for(let y=0; y<canvas.height; y+=40) { ctx.moveTo(0,y); ctx.lineTo(canvas.width,y); } 
        ctx.stroke(); 
    } 
    else if(t === 'music') { 
        ctx.fillStyle = '#111'; ctx.fillRect(0,0,canvas.width,canvas.height); 
        ctx.beginPath(); ctx.strokeStyle = '#444'; 
        for(let b=50; b<canvas.height; b+=150) { 
            for(let l=0; l<5; l++) { let y = b + (l*15); ctx.moveTo(50,y); ctx.lineTo(canvas.width-50,y); } 
        } 
        ctx.stroke(); 
    } 
    else { 
        ctx.fillStyle = '#0a0a0a'; ctx.fillRect(0,0,canvas.width,canvas.height); 
    } 
    broadcastData({type: 'wb-bg', color: t}); 
}

function clearWhiteboard(e) { 
    ctx.clearRect(0,0,canvas.width,canvas.height); 
    changeWbBg('#0a0a0a'); 
    if(e && (window.magnetMode || window.isGuestMagnetized)) broadcastData({type: 'wb-clear'}); 
}

function changeWbPage(d, e) { 
    // PRIORITY 18: MASSIVE PAYLOAD REDUCTION
    // Convert to highly compressed JPEG instead of default lossless PNG.
    // Prevents the 150KB WebRTC firewall from blocking the page sync.
    if(canvas.width > 0) wbPages[currentWbPage] = canvas.toDataURL('image/jpeg', 0.5); 
    
    currentWbPage += d; 
    if(currentWbPage < 0) currentWbPage = 0; 
    if(currentWbPage >= wbPages.length) wbPages.push(''); 
    
    document.getElementById('wbPageIndicator').innerText = `Page ${currentWbPage+1}`; 
    renderCurrentPage(); 
    if(e) broadcastData({type: 'wb-page', page: currentWbPage, data: wbPages[currentWbPage]}); 
}

function renderCurrentPage() { 
    clearWhiteboard(false); 
    if(wbPages[currentWbPage]) { 
        const i = new Image(); 
        i.onload = () => ctx.drawImage(i, 0, 0); 
        i.src = wbPages[currentWbPage]; 
    } 
}

function exportWhiteboard() { 
    const imgData = canvas.toDataURL();
    const fileName = `board-export-p${currentWbPage+1}.png`;
    
    const l = document.createElement('a'); 
    l.download = fileName; 
    l.href = imgData; 
    l.click(); 
    
    // AUTO-CAPTURE TO CABINET
    if (typeof addResourceToCabinet === 'function') addResourceToCabinet(fileName, 'image', imgData, 'fas fa-image');
}

function startPictionary() { 
    if(!isHost) return; 
    const dId = roomMembers[Math.floor(Math.random() * roomMembers.length)].id; 
    const w = ["apple","house","car","dog","sun"][Math.floor(Math.random() * 5)]; 
    broadcastData({type: 'pic-start', drawer: dId, word: w}); 
    handlePicStart(dId, w); 
}

function handlePicStart(dId, w) { 
    pictionaryActive = true; 
    pictionaryWord = w; 
    clearWhiteboard(false); 
    switchMainStage('whiteboardLayer'); 
    
    if(peer.id === dId) { 
        alert("Your Subject: " + w.toUpperCase()); 
    } else { 
        logSystemMsg("Aesthetic Challenge Commenced. Deduce the subject in chat."); 
        currentWbTool = 'none'; 
    } 
    
    if(isHost) { 
        const e = Date.now() + 60000; 
        executeTimer(e); 
        broadcastData({type: 'timer-start', endTime: e}); 
    } 
}

function handlePicWin(n, w) { 
    pictionaryActive = false; 
    if(typeof playBoardSound === 'function') playBoardSound('chime', false); 
    logSystemMsg(`🎉 ${n} successfully deduced: ${w.toUpperCase()}!`); 
    if(isHost) stopTimer(); 
    currentWbTool = 'pen'; 
}

function handleStampUpload(e) { 
    const f = e.target.files[0]; 
    if(!f) return; 
    const r = new FileReader(); 
    r.onload = ev => { 
        currentStampImg = new Image(); 
        currentStampImg.src = ev.target.result; 
        setWbTool('stamp', null); 
    }; 
    r.readAsDataURL(f); 
}

function resizeCanvas() { 
    const s = document.querySelector('.main-stage'); 
    if(s && canvas.width !== s.clientWidth) { 
        let t = null; 
        if(canvas.width > 0) t = ctx.getImageData(0,0,canvas.width,canvas.height); 
        canvas.width = s.clientWidth; 
        canvas.height = s.clientHeight;
        
        ctx.fillStyle = '#0a0a0a';
        ctx.fillRect(0,0,canvas.width,canvas.height);
        if(t) ctx.putImageData(t,0,0); 
    } 
} 
window.addEventListener('resize', resizeCanvas);

// MOBILE FIX: chessboard.js reads the container's rendered width once at
// creation time and does not auto-track later layout changes (e.g. phone
// rotation, or the responsive CSS breakpoints changing #chessBoard's width).
// Re-run its own .resize() (a built-in chessboard.js method) so the board
// and pieces stay correctly sized/aligned instead of stretching or clipping.
window.addEventListener('resize', () => {
    if (typeof visualBoard !== 'undefined' && visualBoard && typeof visualBoard.resize === 'function') {
        visualBoard.resize();
    }
});

// PRIORITY 21: MOBILE TOUCH DRAWING & APPLE PENCIL SUPPORT
// Upgraded from MouseEvents to PointerEvents so it works flawlessly on all touchscreens.
canvas.onpointerdown = e => { 
    if(currentWbTool === 'none') return;
    
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const currentX = (e.clientX - rect.left) * scaleX;
    const currentY = (e.clientY - rect.top) * scaleY;

    if(currentWbTool === 'stamp' && currentStampImg) { 
        const s = document.getElementById('wbSizeSlider').value * 10; 
        ctx.globalCompositeOperation = 'source-over'; 
        ctx.drawImage(currentStampImg, currentX - s/2, currentY - s/2, s, s); 
        return; 
    }
    
    if(currentWbTool === 'text') {
        if(document.getElementById('cTxtI')) document.getElementById('cTxtI').blur();
        const i = document.createElement('input'); 
        i.id = 'cTxtI';
        const s = document.getElementById('wbSizeSlider').value;
        const fontStr = `bold ${s*6}px 'Montserrat', sans-serif`;
        const color = document.getElementById('wbColorPicker').value;
        
        i.style.position = 'absolute'; 
        i.style.left = e.offsetX + 'px'; 
        i.style.top = (e.offsetY - (s*3)) + 'px'; 
        i.style.font = fontStr; 
        i.style.color = color; 
        i.style.background = 'transparent'; 
        i.style.border = `1px dashed ${color}`; 
        i.style.outline = 'none';
        i.style.zIndex = '1000';
        
        document.getElementById('whiteboardLayer').appendChild(i);
        setTimeout(() => i.focus(), 10);
        
       i.onblur = () => { 
            // PRIORITY 29: Limit whiteboard text lengths to prevent GPU rendering crashes
            const safeText = i.value.trim().substring(0, 100);
            if(safeText) drawWbText(safeText, currentX, currentY, true, color, 'Montserrat', s); 
            i.remove(); 
        };
        i.onkeypress = ev => { if(ev.key === 'Enter') i.blur(); };
        return;
    }
    
    isDrawing = true;
    lastX = currentX;
    lastY = currentY;
    drawOnCanvas(lastX, lastY, currentX+0.1, currentY+0.1, document.getElementById('wbColorPicker').value, currentWbTool, document.getElementById('wbSizeSlider').value, true);
};

canvas.onpointermove = e => { 
    if(isDrawing && currentWbTool !== 'text' && currentWbTool !== 'stamp' && currentWbTool !== 'none') { 
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const currentX = (e.clientX - rect.left) * scaleX;
        const currentY = (e.clientY - rect.top) * scaleY;

        const dx = currentX - lastX;
        const dy = currentY - lastY;
        if (dx*dx + dy*dy > 9) {
            drawOnCanvas(lastX, lastY, currentX, currentY, document.getElementById('wbColorPicker').value, currentWbTool, document.getElementById('wbSizeSlider').value, true); 
            lastX = currentX; 
            lastY = currentY; 
        }
    } 
};

window.onpointerup = () => isDrawing = false;
window.onpointercancel = () => isDrawing = false; // Fixes bug where screen swipe breaks the draw loop

function applyToolContext(context, tool, color, baseSize) {
    const size = parseInt(baseSize);
    context.strokeStyle = color; 
    context.fillStyle = color; 
    context.lineCap = 'round'; 
    context.lineJoin = 'round';
    context.shadowBlur = 0; 
    context.globalAlpha = 1.0; 
    context.globalCompositeOperation = 'source-over';
    
    switch(tool) {
        case 'pen': context.lineWidth = size; break;
        case 'pencil': context.lineWidth = size > 2 ? size/2 : 1; context.globalAlpha = 0.6; break;
        case 'marker': context.lineWidth = size * 2.5; break;
        case 'highlighter': context.lineWidth = size * 4; context.globalAlpha = 0.2; break;
        case 'brush': context.lineWidth = size * 1.5; context.shadowBlur = size; context.shadowColor = color; break;
        case 'eraser': context.lineWidth = size * 4; context.globalCompositeOperation = 'destination-out'; break;
    }
}

function drawOnCanvas(x0, y0, x1, y1, c, t, s, emit) { 
    ctx.beginPath(); 
    applyToolContext(ctx, t, c, s);
    ctx.moveTo(x0, y0); 
    ctx.lineTo(x1, y1); 
    ctx.stroke(); 
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1.0;
    
    if(emit && (window.magnetMode || window.isGuestMagnetized)) broadcastData({type: 'draw', x0, y0, x1, y1, color: c, tool: t, size: s}); 
}

function drawWbText(t, x, y, e, c, f, s) { 
    // SECURITY FIX: Strip malicious HTML before drawing to canvas
    const cleanText = window.DOMPurify ? DOMPurify.sanitize(t, {ALLOWED_TAGS: []}) : t;
    
    ctx.font = `bold ${s*6}px '${f}'`; 
    ctx.fillStyle = c; 
    ctx.globalCompositeOperation = 'source-over'; 
    ctx.fillText(cleanText, x, y); 
    if(e && (window.magnetMode || window.isGuestMagnetized)) broadcastData({type: 'wb-text', text: cleanText, x, y, color: c, font: f, size: s}); 
}

function handleIncomingDraw(m) { 
    drawOnCanvas(m.x0, m.y0, m.x1, m.y1, m.color, m.tool, m.size, false); 
}

// ==========================================

// 2. LIVE AI GESTURES (MediaPipe Hands)
// ==========================================
let gestureActive = false;
let myHands = null;
let lastGestureTime = 0;

let lastAiCheck = 0;
async function gestureLoop() {
    if (!gestureActive) return;
    
    // Keep the loop running
    requestAnimationFrame(gestureLoop);
    
    // CPU SAVER: Force a maximum of 10 checks per second
    const now = Date.now();
    if (now - lastAiCheck < 100) return; 
    lastAiCheck = now;

    const vid = document.getElementById('localVideo');
    if (vid && vid.readyState >= 2 && !vid.paused) {
        await myHands.send({image: vid});
    }
}

async function toggleGestures() {
    if (!window.Hands) return alert("MediaPipe CDN not loaded yet. Try again.");
    
    gestureActive = !gestureActive;
    const btn = document.getElementById('aiGestureBtn');
    
    if (gestureActive) {
        btn.classList.add('active');
        logSystemMsg("AI Tracking initialized. Awaiting calibration.");
        
        if(!myHands) {
            myHands = new Hands({locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`});
            myHands.setOptions({ maxNumHands: 1, modelComplexity: 1, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
            myHands.onResults(onHandResults);
            await myHands.initialize();
        }
        
        gestureLoop();
        
    } else {
        btn.classList.remove('active');
        logSystemMsg("AI Tracking suspended.");
    }
}

function onHandResults(results) {
    if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) return;
    const lm = results.multiHandLandmarks[0];
    
    const thumbUp = lm[4].y < lm[3].y && lm[8].y > lm[6].y && lm[12].y > lm[10].y && lm[16].y > lm[14].y;
    const thumbDown = lm[4].y > lm[3].y && lm[8].y < lm[6].y && lm[12].y < lm[10].y && lm[16].y < lm[14].y;
    const openPalm = lm[8].y < lm[6].y && lm[12].y < lm[10].y && lm[16].y < lm[14].y && lm[20].y < lm[18].y;
    const shh = lm[8].y < lm[6].y && lm[12].y > lm[10].y && lm[16].y > lm[14].y;
    
    const now = Date.now();
    if (now - lastGestureTime < 2500) return;
    
    if (thumbUp) { triggerReaction('👍'); lastGestureTime = now; }
    else if (thumbDown) { triggerReaction('👎'); lastGestureTime = now; }
    else if (shh) { 
        const t = localStream.getAudioTracks()[0]; 
        if(t && t.enabled) document.getElementById('micBtn').click(); 
        lastGestureTime = now; 
    }
    else if (openPalm) { toggleHandRaise(); lastGestureTime = now; }
}

function triggerReaction(emoji) {
    broadcastData({type: 'reaction', peerId: peer.id, emoji: emoji});
    showReactionUI(peer.id, emoji);
}

function showReactionUI(pId, emoji) {
    const wid = pId === peer.id ? 'wrapper-local' : 'wrapper-' + pId;
    let w = document.getElementById(wid);
    
    // FIX: If the video box doesn't exist (camera off), fallback to the main screen
    if(!w) w = document.getElementById('videoLayer');
    if(!w) return;
    
    const eDiv = document.createElement('div');
    eDiv.className = 'reaction-float';
    eDiv.innerText = emoji;
    w.appendChild(eDiv);
    
    setTimeout(() => eDiv.remove(), 2000);
    if (typeof playBoardSound === 'function') playBoardSound('chime', false);
}

// ==========================================
// 4. DEVELOPMENT, MARKDOWN, QUIZ
// ==========================================
let myCodeEditor;
window.addEventListener('load', () => {
    myCodeEditor = CodeMirror.fromTextArea(document.getElementById('codeEditorArea'), { 
        lineNumbers: true, 
        mode: "htmlmixed",  
        theme: "monokai" 
    });
    
    const defaultCode = `<!DOCTYPE html>\n<html>\n<head>\n<style>\n  body { font-family: sans-serif; text-align: center; margin-top: 50px; }\n  h1 { color: #e60000; }\n</style>\n</head>\n<body>\n  <h1>Welcome to Development Studio</h1>\n  <p>Write HTML, CSS, and JavaScript here.</p>\n  <button onclick="alert('Working!')">Test JS</button>\n</body>\n</html>`;
    myCodeEditor.setValue(defaultCode);
    
    myCodeEditor.on('change', (editor, change) => { 
        if(change.origin !== 'setValue') { 
            broadcastData({type: 'code-edit', code: editor.getValue()}); 
        } 
    });
});

function runCode() {
    const code = myCodeEditor.getValue();
    const iframe = document.getElementById('codeOutput');
    const doc = iframe.contentDocument || iframe.contentWindow.document;
    doc.open();
    doc.write(code);
    doc.close();
}

// Markdown Studio
document.getElementById('mdInput').addEventListener('input', (e) => {
    const val = e.target.value;
    renderMarkdown();
    broadcastData({type: 'md-edit', text: val});
});

function renderMarkdown() {
    if(window.marked && window.DOMPurify) {
        // SECURITY FIX: Parse Markdown, then sanitize the resulting HTML before injecting
        const rawHtml = marked.parse(document.getElementById('mdInput').value);
        document.getElementById('mdOutput').innerHTML = DOMPurify.sanitize(rawHtml);
    }
}

function exportMarkdown() {
    const html = document.getElementById('mdOutput').innerHTML;
    const blob = new Blob([
        `<html><head><title>Export</title><style>body{font-family:sans-serif; padding:40px; line-height:1.6; max-width:800px; margin:0 auto;}</style></head><body>${html}</body></html>`
    ], {type: 'text/html'});
    const a = document.createElement('a'); 
    a.href = URL.createObjectURL(blob); 
    a.download = 'space-journal.html'; 
    a.click();
}

// Live Quiz Engine
let quizData = []; 
let currentQuizIdx = 0; 
let quizScores = {};
let quizTimerInterval = null;
let currentQuizAnswered = new Set(); // PRIORITY 17: Track who answered the current question

function startBuiltQuiz() {
    if(!isHost) return;
    
   // PRIORITY 29: Hard limit Quiz Inputs (150 chars for Q, 60 chars for Options)
    const q = document.getElementById('quizQ').value.trim().substring(0, 150);
    const o1 = document.getElementById('quizO1').value.trim().substring(0, 60);
    const o2 = document.getElementById('quizO2').value.trim().substring(0, 60);
    const o3 = document.getElementById('quizO3').value.trim().substring(0, 60);
    const o4 = document.getElementById('quizO4').value.trim().substring(0, 60);
    const a = parseInt(document.getElementById('quizAnswer').value);
    
    // 2. Make sure they didn't leave anything blank
    if(!q || !o1 || !o2 || !o3 || !o4) {
        alert("Please fill out the question and all 4 options.");
        return;
    }
    
    // 3. Automatically build the data structure behind the scenes
    quizData = [{
        "q": q,
        "opts": [o1, o2, o3, o4],
        "a": a
    }];
    
    // 4. Run the rest of the quiz logic exactly like before
    quizScores = {};
    broadcastData({type: 'quiz-start'});
    switchSidebarTab('polls'); 
    switchMainStage('quizLayer');
    
    document.getElementById('quizDisplay').innerHTML = `<h1 class="serif-text" style="color:var(--accent); font-size:3rem; margin-bottom:20px;">Commencing Assessment...</h1>`;
    
    // 5. Clean up the form for the next question
    document.getElementById('quizQ').value = '';
    document.getElementById('quizO1').value = '';
    document.getElementById('quizO2').value = '';
    document.getElementById('quizO3').value = '';
    document.getElementById('quizO4').value = '';
    document.getElementById('quizAnswer').value = '0';
    currentQuizIdx = 0;
    clearInterval(quizTimerInterval);

    setTimeout(nextQuizQuestion, 3000);
}

function nextQuizQuestion() {
   if(currentQuizIdx >= quizData.length) {
        broadcastData({type: 'quiz-score', scores: quizScores}); 
        renderQuizLeaderboard(quizScores);
        currentQuizIdx = 0; 
        if(typeof playBoardSound === 'function') playBoardSound('applause', true); 
        return;
    }
    
    currentQuizAnswered.clear(); // PRIORITY 17: Reset answer tracking for the new question
    
    const q = quizData[currentQuizIdx];
    broadcastData({type: 'quiz-q', q: q.q, opts: q.opts});
    renderQuizQuestion(q.q, q.opts);
    
    let timeLeft = 10;
    clearInterval(quizTimerInterval);
    quizTimerInterval = setInterval(() => {
        timeLeft--;
        const c = document.getElementById('quizClock'); 
        if(c) c.innerText = timeLeft;
        if(timeLeft <= 0) { 
            clearInterval(quizTimerInterval); 
            currentQuizIdx++; 
            nextQuizQuestion(); 
        }
    }, 1000);
}

function renderQuizQuestion(q, opts) {
    // SECURITY FIX: Strip HTML from Quiz questions and options
    const safeQ = window.DOMPurify ? DOMPurify.sanitize(q, {ALLOWED_TAGS: []}) : q;
    
    let h = `<h1 style="font-size:2.5rem; margin-bottom:10px; font-weight:300;">${safeQ}</h1>
             <h2 id="quizClock" style="color:var(--accent); font-size:4rem; margin-bottom:30px; font-family:'Cinzel',serif;">10</h2>
             <div style="display:flex; flex-wrap:wrap; justify-content:center; max-width:800px; margin:0 auto;">`;
    
    opts.forEach((opt, i) => { 
        const safeOpt = window.DOMPurify ? DOMPurify.sanitize(opt, {ALLOWED_TAGS: []}) : opt;
        h += `<button class="quiz-btn" onclick="submitQuizAns(${i})">${safeOpt}</button>`; 
    });
    h += `</div>`;
    document.getElementById('quizDisplay').innerHTML = h;
}

function submitQuizAns(i) {
    if(isHost) handleQuizAnswer(peer.id, i); 
    else broadcastData({type: 'quiz-ans', peerId: peer.id, ansIdx: i});
    
    document.getElementById('quizDisplay').innerHTML = `<h1 style="color:#666; font-weight:300; font-style:italic;">Response Logged. Awaiting others.</h1>`;
}

function handleQuizAnswer(pId, ansIdx) {
    if (!isHost) return; 
    
    // PRIORITY 17: Prevent duplicate answers and validate option format
    if (currentQuizAnswered.has(pId) || typeof ansIdx !== 'number') return;
    currentQuizAnswered.add(pId);
    
    const correct = quizData[currentQuizIdx]?.a;
    if(ansIdx === correct) {
        const name = pId === peer.id ? myDisplayName : (roomMembers.find(m=>m.id===pId)?.name || "Guest");
        quizScores[name] = (quizScores[name] || 0) + 100;
    }
}

function renderQuizLeaderboard(scores) {
    let h = `<h1 class="serif-text" style="color:var(--accent); font-size:3rem; margin-bottom:40px; letter-spacing:2px;">Assessment Results</h1>
             <div style="text-align:left; max-width:500px; margin:0 auto; font-size:1.2rem; width:100%;">`;
    
    Object.entries(scores).sort((a,b) => b[1]-a[1]).forEach((s, i) => { 
        const safeName = window.DOMPurify ? DOMPurify.sanitize(s[0], {ALLOWED_TAGS: []}) : s[0];
        h += `<div style="background:#0a0a0a; border:1px solid #220000; padding:20px; margin-bottom:10px; border-radius:4px; display:flex; justify-content:space-between;">
                <span style="color:#aaa;">#${i+1} ${safeName}</span> 
                <span style="color:var(--accent); font-weight:bold;">${s[1]} pts</span>
              </div>`; 
    });
    
    h += `</div><button class="btn" style="margin-top:40px; padding: 15px 40px; letter-spacing:2px;" onclick="switchMainStage('videoLayer')">Conclude</button>`;
    document.getElementById('quizDisplay').innerHTML = h;
}

// ==========================================
// 5. CHUNKED FILES & DIRECT FILE VIEWER
// ==========================================
let rxFileChunks = []; 
let rxFileTotal = 0; 
let rxFileName = ""; 
let rxFileMime = "";
let cancelFileTransfer = false; // Global abort switch

function handleChunkedFileUpload(e) {
    const f = e.target.files[0]; 
    if(!f) return;
    
    // 1. STRICT FILE SIZE LIMIT (5MB max for free WebRTC chunking)
    const MAX_SIZE = 5 * 1024 * 1024;
    if (f.size > MAX_SIZE) {
        alert("File too large. Maximum size for direct peer-to-peer transfer is 5MB.");
        e.target.value = ''; // Cleanup
        return;
    }

    cancelFileTransfer = false;
    document.getElementById('globalFileProgressWrapper').style.display = 'block'; 
    document.getElementById('transferFileName').innerText = "Uploading: " + f.name;
    
    const pctEl = document.getElementById('transferPct');
    if (pctEl) pctEl.innerHTML = `0% <span style="color:#ff4444; cursor:pointer; margin-left:10px;" onclick="cancelFileTransfer = true;">[CANCEL]</span>`;
    
    const r = new FileReader(); 
    r.onload = ev => {
        const b64 = ev.target.result; 
        const sz = 50000; 
        const tot = Math.ceil(b64.length / sz);
        
        broadcastData({type: 'file-meta', name: f.name, mime: f.type, total: tot});
        
        let i = 0; 
        const n = () => { 
            // 2. ABORT LOGIC: Stop uploading and notify guests immediately
            if (cancelFileTransfer) {
                broadcastData({type: 'file-cancel'});
                document.getElementById('globalFileProgressWrapper').style.display = 'none';
                logSystemMsg("Upload cancelled.");
                document.getElementById('fileUpload').value = '';
                return;
            }

            if(i < tot) { 
                broadcastData({type: 'file-chunk', index: i, data: b64.slice(i*sz, (i+1)*sz)}); 
                i++; 
                let pct = Math.round((i/tot)*100);
                document.getElementById('fileProgressFill').style.width = pct + '%'; 
                if (pctEl) pctEl.innerHTML = `${pct}% <span style="color:#ff4444; cursor:pointer; margin-left:10px;" onclick="cancelFileTransfer = true;">[CANCEL]</span>`;
                setTimeout(n, 10); 
            } else { 
                // 3. SUCCESS CLEANUP: Finish and wipe the input
                if (pctEl) pctEl.innerText = "100% - COMPLETE";
                setTimeout(() => document.getElementById('globalFileProgressWrapper').style.display = 'none', 2000); 
                logSystemMsg("File successfully distributed to space.");
                renderSharedMedia(b64, f.type, f.name); 
                document.getElementById('fileUpload').value = ''; 
            } 
        }; 
        n();
    }; 
    r.readAsDataURL(f);
}

// PRIORITY 19: FILE TRANSFER MEMORY LEAK PROTECTION
let fileTransferTimeout = null;

function initReceiveFile(n, m, t) { 
    rxFileName = n; 
    rxFileMime = m; 
    rxFileTotal = t; 
    rxFileChunks = []; 
    
    document.getElementById('globalFileProgressWrapper').style.display = 'block'; 
    document.getElementById('transferFileName').innerText = "Downloading: " + n; 
    document.getElementById('fileProgressFill').style.width = '0%'; 
    
    const pctEl = document.getElementById('transferPct');
    if (pctEl) pctEl.innerText = "0%";
    
    // START THE TIMEOUT: If the sender disconnects, clear RAM after 15 seconds
    clearTimeout(fileTransferTimeout);
    fileTransferTimeout = setTimeout(abortStalledTransfer, 15000);
}

function abortStalledTransfer() {
    if (Object.keys(rxFileChunks).length > 0 && Object.keys(rxFileChunks).length < rxFileTotal) {
        console.warn("File transfer stalled. Purging memory to prevent leaks.");
        rxFileChunks = []; // Deep RAM purge
        document.getElementById('globalFileProgressWrapper').style.display = 'none';
        logSystemMsg("File transfer interrupted and aborted.");
    }
}

function receiveFileChunk(i, d) { 
    if (rxFileChunks[i]) return; // PRIORITY 19: Prevent duplicate chunks from corrupting the file

    rxFileChunks[i] = d; 
    let r = Object.keys(rxFileChunks).length; 
    let pct = Math.round((r/rxFileTotal)*100);
    
    document.getElementById('fileProgressFill').style.width = pct + '%'; 
    const pctEl = document.getElementById('transferPct');
    if (pctEl) pctEl.innerText = pct + "%";

    // KICK THE TIMEOUT: We successfully received a chunk, reset the 15-second death clock
    clearTimeout(fileTransferTimeout);

    if(r === rxFileTotal) { 
        if (pctEl) pctEl.innerText = "100% - COMPLETE";
        setTimeout(() => document.getElementById('globalFileProgressWrapper').style.display = 'none', 2000); 
        renderSharedMedia(rxFileChunks.join(''), rxFileMime, rxFileName); 
        rxFileChunks = []; // RAM CLEANUP: Dump from memory now that it's rendered
    } else {
        // Keep the timeout alive for the next chunk
        fileTransferTimeout = setTimeout(abortStalledTransfer, 15000);
    }
}

function renderSharedMedia(u, m, n) { 
    const cleanN = window.DOMPurify ? DOMPurify.sanitize(n, {ALLOWED_TAGS: []}).replace(/>/g, '&gt;').replace(/</g, '&lt;') : n.replace(/[<>]/g, '');
    switchMainStage('mediaLayer');
    const content = document.getElementById('mediaRenderContainer');
    
    if (typeof addResourceToCabinet === 'function') addResourceToCabinet(cleanN, 'file', u, 'fas fa-file-alt');
    
    if(m.startsWith('video/')) {
        content.innerHTML = `<video src="${u}" controls autoplay style="width:100%; height:100%; object-fit:contain;"></video>`; 
    } else if(m.startsWith('image/')) {
        content.innerHTML = `<img src="${u}" style="width:100%; height:100%; object-fit:contain;">`; 
  } else if(m === 'application/pdf') {
        content.innerHTML = `<div id="pdfViewer" style="width:100%; height:100%; overflow:auto; background:#333; display:flex; flex-direction:column; align-items:center; padding:10px; box-sizing:border-box;">
            <div style="color:white; margin-bottom:10px;">Loading Document...</div>
        </div>`;
        const pdfViewer = document.getElementById('pdfViewer');
        
        // Fetch to blob if dataUrl, otherwise just use URL
        const dataUrlFetch = u.startsWith('data:') ? fetch(u).then(res => res.arrayBuffer()) : Promise.resolve(u);
        
        dataUrlFetch.then(src => {
            const loadingTask = window.pdfjsLib ? window.pdfjsLib.getDocument(src) : null;
            if (loadingTask) {
                loadingTask.promise.then(pdf => {
                    pdfViewer.innerHTML = ''; // Clear loading text
                    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
                        pdf.getPage(pageNum).then(page => {
                            const canvas = document.createElement('canvas');
                            canvas.style.maxWidth = '100%';
                            canvas.style.marginBottom = '15px';
                            canvas.style.boxShadow = '0 5px 15px rgba(0,0,0,0.5)';
                            
                            const viewport = page.getViewport({ scale: 1.5 });
                            canvas.width = viewport.width;
                            canvas.height = viewport.height;
                            
                            const renderContext = { canvasContext: canvas.getContext('2d'), viewport: viewport };
                            page.render(renderContext);
                            pdfViewer.appendChild(canvas);
                        });
                    }
                }).catch(err => {
                    console.error("PDF Render Error:", err);
                    pdfViewer.innerHTML = `<div style="color:white; margin:auto;">Failed to load PDF. <a href="${u}" download="${cleanN}" style="color:var(--accent);">Download File</a></div>`;
                });
            } else {
                fetch(u).then(res => res.blob()).then(blob => {
                    const blobUrl = URL.createObjectURL(blob);
                    pdfViewer.innerHTML = `<iframe src="${blobUrl}" style="width:100%; height:100%; border:none; background:white;"></iframe>`;
                });
            }
        });
    } else {
        content.innerHTML = `<div style="text-align:center;color:white;"><i class="fas fa-file" style="font-size:5rem; color:var(--accent);"></i><h3 style="margin:20px 0; font-family:'Cinzel',serif; font-weight:normal; letter-spacing:2px;">${cleanN}</h3><a href="${u}" download="${cleanN}" class="btn">Download Archive</a></div>`; 
    }
}

// ==========================================
// 6. TIMERS & POLLS
// ==========================================
let timerInterval = null;

function startTimer() { 
    const e = Date.now() + (parseInt(document.getElementById('timerMins').value) * 60000); 
    executeTimer(e); 
    broadcastData({type: 'timer-start', endTime: e}); 
}

function stopTimer() { 
    clearInterval(timerInterval); 
    document.getElementById('sharedTimerDisplay').style.display = 'none'; 
    broadcastData({type: 'timer-stop'}); 
}

function executeTimer(e) {
    const d = document.getElementById('sharedTimerDisplay'); 
    d.style.display = 'block'; 
    d.style.borderColor = "var(--accent)";
    d.style.color = "var(--accent)";
    clearInterval(timerInterval);
    
    timerInterval = setInterval(() => {
        let r = Math.floor((e - Date.now()) / 1000);
        if(r <= 0) { 
            clearInterval(timerInterval); 
            d.innerText = "00:00"; 
            d.style.borderColor = "#ff4444"; 
            d.style.color = "#ff4444"; 
            if(typeof playBoardSound === 'function') playBoardSound('buzzer', false); 
            setTimeout(() => { d.style.display = 'none'; d.style.borderColor = "var(--accent)"; d.style.color = "var(--accent)"; }, 3000); 
            return; 
        }
        d.innerText = `${Math.floor(r/60).toString().padStart(2,'0')}:${(r%60).toString().padStart(2,'0')}`;
    }, 1000);
}

let activePollQuestion = ""; 
let activePollOptions = []; 
let activePollVotes = [];
let activePollVoters = new Set(); // PRIORITY 17: Track who voted to prevent spam

function launchPoll() { 
    // PRIORITY 29: Hard limit Poll Inputs (150 chars for Q, 60 chars for Options)
    activePollQuestion = document.getElementById('pollQ').value.trim().substring(0, 150); 
    const o1 = document.getElementById('pollO1').value.trim().substring(0, 60); 
    const o2 = document.getElementById('pollO2').value.trim().substring(0, 60);
    
    if(!activePollQuestion || !o1 || !o2) return; 
    
    activePollOptions = [o1, o2]; 
    activePollVotes = [0, 0]; 
    activePollVoters.clear(); // Reset voters for the new poll
    
    renderActivePoll(activePollQuestion, activePollOptions, activePollVotes); 
    broadcastData({type: 'poll-start', question: activePollQuestion, options: activePollOptions, votes: activePollVotes}); 
}

function renderActivePoll(q, o, v) { 
    activePollQuestion = q; 
    activePollOptions = o; 
    activePollVotes = v; 
    const c = document.getElementById('activePollContainer'); 
    let t = v.reduce((a, b) => a + b, 0); 
    
    // SECURITY FIX: Strip HTML from Poll Questions and Options
    const safeQ = window.DOMPurify ? DOMPurify.sanitize(q, {ALLOWED_TAGS: []}) : q;
    
    let h = `<div style="background:#050505; padding:20px; border-radius:2px; border:1px solid var(--border-color);">
             <b style="color:white; display:block; margin-bottom:15px; font-weight:500;">${safeQ}</b>`; 
    
    o.forEach((opt, i) => { 
        const safeOpt = window.DOMPurify ? DOMPurify.sanitize(opt, {ALLOWED_TAGS: []}) : opt;
        let p = t === 0 ? 0 : Math.round((v[i]/t) * 100); 
        h += `
            <div onclick="submitVote(${i})" style="margin-top:10px; cursor:pointer; position:relative; background:#111; height:30px; border-radius:2px; overflow:hidden; border:1px solid #330000;">
                <div style="width:${p}%; background:var(--accent); opacity:0.4; height:100%; transition: width 0.4s;"></div>
                <span style="position:absolute; top:5px; left:10px; font-size:0.75rem; color: white; letter-spacing:1px; text-transform:uppercase;">${safeOpt} (${v[i]})</span>
            </div>`; 
    });
 
    c.innerHTML = h + '</div>'; 
}

function submitVote(i) { 
    if(isHost) { 
        activePollVotes[i]++; 
        broadcastData({type: 'poll-results', votes: activePollVotes}); 
        renderActivePoll(activePollQuestion, activePollOptions, activePollVotes); 
    } else { 
        broadcastData({type: 'poll-vote', index: i}); 
        document.getElementById('activePollContainer').style.pointerEvents = 'none'; 
        document.getElementById('activePollContainer').style.opacity = '0.7';
    } 
}

// ==========================================
// 10. MEDIA, BROWSERS, & YOUTUBE
// ==========================================
function triggerWebBrowser() { 
    let u = document.getElementById('browserInput').value; 
    if(u) loadSharedBrowser(u, true); 
}

function openDirectYouTube() {
    switchMainStage('youtubeLayer');
}

function loadSharedBrowser(u, e) { 
    if(!u.startsWith('http')) u = 'https://' + u; 
    document.getElementById('sharedBrowser').src = u; 
    document.getElementById('externalLinkBtn').href = u; 
    switchMainStage('browserLayer'); 
    
    // AUTO-CAPTURE TO CABINET
    if (typeof addResourceToCabinet === 'function') addResourceToCabinet(u, 'link', u, 'fas fa-globe');
    
    if(e) { broadcastData({type: 'iframe-load', url: u}); logSystemMsg("External interface rendered."); } 
}

let ytPlayer; 
let currentYtVideoId = 'M7lc1UVf-VE';
let currentActiveStage = 'videoLayer';
let currentRoomHostId = null;

// 1. Manually download the YouTube API only after the app is ready
const ytTag = document.createElement('script');
ytTag.src = "https://www.youtube.com/iframe_api";
document.head.appendChild(ytTag);

// 2. Attach the ready function directly to the browser window so YouTube can find it
window.onYouTubeIframeAPIReady = function() { 
    ytPlayer = new YT.Player('ytPlayer',{
        height:'100%', width:'100%', videoId: 'M7lc1UVf-VE', 
        playerVars: { 'autoplay': 1, 'controls': 1, 'mute': 1, 'rel': 0, 'showinfo': 0, 'origin': window.location.origin },
        events:{
            'onStateChange': e => {
                if (!isHost || !window.magnetMode) return;
                const s = ytPlayer.getPlayerState();
                if(s === 1 || s === 2 || s === 3) {
                    broadcastData({ type: 'yt-master-sync', vidId: currentYtVideoId, time: ytPlayer.getCurrentTime(), state: s });
                }
            }
        }
    }); 
};
function triggerYouTubeSync() { 
    if (!isHost) {
        alert("Only the Host can broadcast a new video to the room.");
        return;
    }
    const input = document.getElementById('ytInput').value.trim(); 
    if(!input) return;

    const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i;
    const match = input.match(regex);
    const vidId = match ? match[1] : input;

    if (vidId.length === 11) {
        currentYtVideoId = vidId; 
        switchMainStage('youtubeLayer'); 
        
        if (typeof addResourceToCabinet === 'function') addResourceToCabinet('YouTube Video', 'youtube', `https://youtube.com/watch?v=${vidId}`, 'fab fa-youtube');
        
        const pushVideo = (retries = 10) => {
            if (typeof ytPlayer !== 'undefined' && typeof ytPlayer.loadVideoById === 'function') {
                ytPlayer.loadVideoById(vidId); 
            } else if (retries > 0) {
                setTimeout(() => pushVideo(retries - 1), 500);
            } else {
                console.warn("YouTube API failed to initialize.");
                logSystemMsg("YouTube connection failed.");
            }
        };
        pushVideo();
        
        broadcastData({type: 'yt-load', vidId: vidId}); 
        logSystemMsg("Broadcasting YouTube media."); 
        document.getElementById('ytInput').value = ''; 
    } else {
        alert("Invalid YouTube Link. Please paste a standard YouTube URL.");
    }
}

function handleYtSync(c, hostTime) { 
    if(c === 'play') ytPlayer.playVideo(); else ytPlayer.pauseVideo(); 

    if (hostTime !== undefined && typeof ytPlayer.seekTo === 'function') {
        setTimeout(() => {
            let myTime = ytPlayer.getCurrentTime() || 0;
            let expectedTime = c === 'play' ? hostTime + 0.5 : hostTime;
            if (Math.abs(myTime - expectedTime) > 0.5) ytPlayer.seekTo(expectedTime, true);
        }, 500); 
    }
}

window.addEventListener('load', () => {
    resizeCanvas();
});
// --- LIVE LOBBY LISTENER ---
window.addEventListener('load', () => {
    const roomsRef = db.ref('rooms');
    roomsRef.on('value', snapshot => {
        const data = snapshot.val();
        const grid = document.getElementById('roomsListGrid');
        if(!grid) return;

        if (!data) {
            grid.innerHTML = `<p style="color: #666; text-align: center; font-style: italic; font-size: 0.85rem;">No active spaces right now. Reserve one above!</p>`;
            return;
        }

   grid.innerHTML = '';
        Object.values(data).forEach(room => {
            // SECURITY FIX: Strip HTML from Firebase Database values before rendering the Lobby
            const safeRoomName = window.DOMPurify ? DOMPurify.sanitize(room.roomName, {ALLOWED_TAGS: []}) : room.roomName;
            const safeHostName = window.DOMPurify ? DOMPurify.sanitize(room.hostName, {ALLOWED_TAGS: []}) : room.hostName;
            const safeTopic = window.DOMPurify ? DOMPurify.sanitize(room.topic, {ALLOWED_TAGS: []}) : (room.topic || 'General');

            const isLocked = room.isLocked ? '<i class="fas fa-lock" style="color:#ff4444;" title="Passcode Required"></i>' : '<i class="fas fa-globe" style="color:#00ff66;" title="Public"></i>';
            
            grid.innerHTML += `
                <div class="room-card" style="border-left: 4px solid var(--accent); margin-bottom: 15px;">
                    <div class="room-card-info" style="flex: 1;">
                        <div style="display:flex; align-items:center; gap:10px;">
                            <b style="font-size: 1.1rem; color: #fff;">${safeRoomName}</b>
                            ${isLocked}
                        </div>
                        <div style="display:flex; flex-wrap: wrap; gap: 10px; margin-top: 10px;">
                            <span style="background: rgba(230,0,0,0.15); color: var(--accent); padding: 5px 10px; border-radius: 4px; font-size: 0.75rem; font-weight: bold; letter-spacing: 1px; border: 1px solid rgba(230,0,0,0.3);">🏷️ ${safeTopic}</span>
                            <span style="background: #111; border: 1px solid #333; color: #aaa; padding: 5px 10px; border-radius: 4px; font-size: 0.75rem; font-weight: 500;">👥 Max: ${room.capacity}</span>
                        </div>
                        <div style="margin-top: 12px; font-size: 0.8rem; color: #666;">
                            Hosted by <span style="color: #ddd; font-weight: 500;">${safeHostName}</span>
                        </div>
                    </div>
                    <button class="btn" style="padding: 12px 25px; font-size: 0.8rem; margin-left: 15px;" onclick="joinPublicRoom('${room.roomId}')">Join Space</button>
                </div>
            `;
        });
    });
});

function joinPublicRoom(rId) {
    document.getElementById('lobbyJoinId').value = rId;
    joinRoom();
}
// --- SEARCH & FOLLOW FUNCTIONS ---
function searchUsers() {
    const query = document.getElementById('userSearchInput').value.trim().toLowerCase();
    if (!query) return;

    db.ref('users').once('value', snapshot => {
        const users = snapshot.val();
        const resultsDiv = document.getElementById('searchResults');
        resultsDiv.innerHTML = '';

        if (!users) return;

        Object.values(users).forEach(u => {
            if (u.uid !== auth.currentUser.uid && u.displayName.toLowerCase().includes(query)) {
                const safeName = window.DOMPurify ? DOMPurify.sanitize(u.displayName, {ALLOWED_TAGS:[]}) : u.displayName.replace(/[<>]/g, '');
                const row = document.createElement('div');
                row.className = 'user-row';
                
                const info = document.createElement('div');
                info.className = 'user-row-info';
                info.innerHTML = `<img src="${u.photoURL}" class="user-avatar"><span style="color:#fff; font-size:0.85rem;">${safeName}</span>`;
                
                const btnFollow = document.createElement('button');
                btnFollow.className = 'btn';
                btnFollow.style.cssText = 'padding: 4px 8px; font-size: 0.7rem;';
                
                // If we are already following them (or requested), show Requested state
                if (typeof myFollowing !== 'undefined' && myFollowing[u.uid]) {
                    if (typeof myFollowers !== 'undefined' && myFollowers[u.uid]) {
                        btnFollow.textContent = 'Friends';
                        btnFollow.disabled = true;
                        btnFollow.style.background = '#00aa00';
                        btnFollow.style.cursor = 'default';
                    } else {
                        btnFollow.textContent = 'Requested';
                        btnFollow.disabled = true;
                        btnFollow.style.background = '#555';
                        btnFollow.style.cursor = 'default';
                    }
                } else {
                    btnFollow.textContent = 'Follow';
                    btnFollow.addEventListener('click', () => {
                        followUser(u.uid, safeName, u.photoURL);
                        btnFollow.textContent = 'Requested';
                        btnFollow.disabled = true;
                        btnFollow.style.background = '#555';
                        btnFollow.style.cursor = 'default';
                    });
                }
                
                const btnMsg = document.createElement('button');
                btnMsg.className = 'btn';
                btnMsg.style.cssText = 'padding: 4px 8px; font-size: 0.7rem; background: #444; margin-left: 5px;';
                btnMsg.textContent = 'Message';
                btnMsg.addEventListener('click', () => {
                    openDirectChat(u.uid, safeName);
                    document.getElementById('directChatContainer').scrollIntoView({behavior: 'smooth', block: 'nearest'});
                });
                
                const btnsDiv = document.createElement('div');
                btnsDiv.style.display = 'flex';
                btnsDiv.appendChild(btnFollow);
                btnsDiv.appendChild(btnMsg);
                
                row.appendChild(info);
                row.appendChild(btnsDiv);
                resultsDiv.appendChild(row);
            }
        });
    });
}



function listenForIncomingCalls(myUid) {
    db.ref(`calls/${myUid}`).on('value', snapshot => {
        const data = snapshot.val();
        if (data) {
            document.getElementById('callerNameText').innerText = `${data.callerName} is calling...`;
            document.getElementById('incomingCallModal').style.display = 'flex';
        } else {
            document.getElementById('incomingCallModal').style.display = 'none';
        }
    });
}

async function acceptIncomingCall() {
    document.getElementById('incomingCallModal').style.display = 'none';
    db.ref(`calls/${auth.currentUser.uid}`).remove(); // Clear the ring notification

    try {
        // Get your microphone to answer them
        localAudioStream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
        
        if (currentAudioCall) {
            currentAudioCall.answer(localAudioStream);
            setupAudioCallEvents(currentAudioCall);
            document.getElementById('audioCallStatusText').innerText = "Call Connected";
            document.getElementById('activeAudioCallWidget').style.display = 'flex';
        }
    } catch (err) {
        alert("Microphone access is required to answer.");
    }
}

function declineIncomingCall() {
    db.ref(`calls/${auth.currentUser.uid}`).remove();
    document.getElementById('incomingCallModal').style.display = 'none';
}

function setupAudioCallEvents(call) {
    call.on('stream', remoteStream => {
        document.getElementById('audioCallStatusText').innerText = "Call Connected";
        document.getElementById('remoteAudioStream').srcObject = remoteStream;
    });
    call.on('close', () => {
        endAudioCall(false); 
    });
}

function endAudioCall(closeConnection = true) {
    if (closeConnection && currentAudioCall) {
        currentAudioCall.close();
    }
    // Shut off the microphone when the call ends
    if (localAudioStream) {
        localAudioStream.getTracks().forEach(track => track.stop());
    }
    document.getElementById('activeAudioCallWidget').style.display = 'none';
    document.getElementById('remoteAudioStream').srcObject = null;
    currentAudioCall = null;
    localAudioStream = null;
}
// --- SOCIAL HUB TAB NAVIGATION ---

let currentDirectChatRef = null;

function openDirectChat(friendUid, friendName) {
    currentActiveChatFriendId = friendUid;
    document.getElementById('directChatTitle').innerHTML = '<i class="fas fa-comments"></i> Chat with ' + (window.DOMPurify ? DOMPurify.sanitize(friendName, {ALLOWED_TAGS:[]}) : friendName.replace(/[<>]/g, ''));
    
    const myUid = auth.currentUser.uid;
    const chatId = myUid < friendUid ? myUid + '_' + friendUid : friendUid + '_' + myUid;

    if (currentDirectChatRef) {
        currentDirectChatRef.off('value');
    }

    currentDirectChatRef = db.ref('direct_chats/' + chatId);
    currentDirectChatRef.on('value', snapshot => {
        const msgs = snapshot.val();
        const msgContainer = document.getElementById('directChatMessages');
        if (!msgContainer) return;
        
        msgContainer.innerHTML = '';
        if (!msgs) {
            msgContainer.innerHTML = '<p class="empty-state">No messages yet. Say hi!</p>';
            return;
        }

        Object.values(msgs).forEach(m => {
            const isMe = m.senderId === myUid;
            const wrapper = document.createElement('div');
            wrapper.className = isMe ? 'chat-bubble-wrapper me' : 'chat-bubble-wrapper them';
            
            const bubble = document.createElement('div');
            bubble.className = 'chat-bubble';
            bubble.textContent = m.text;
            
            wrapper.appendChild(bubble);
            msgContainer.appendChild(wrapper);
        });
        
        // Scroll to bottom
        msgContainer.scrollTop = msgContainer.scrollHeight;
    });
}

function sendDirectMessage() {
    const input = document.getElementById('directMessageInput');
    const text = input.value.trim().substring(0, 500);
    if (!text || !currentActiveChatFriendId) return;

    const myUid = auth.currentUser.uid;
    const friendUid = currentActiveChatFriendId;
    const chatId = myUid < friendUid ? myUid + '_' + friendUid : friendUid + '_' + myUid;

    db.ref('direct_chats/' + chatId).push({
        senderId: myUid,
        text: text,
        timestamp: Date.now()
    });

    // Always drop a message_request (the receiver UI will hide it if they are already mutual friends)
    const safeName = typeof myDisplayName !== 'undefined' ? myDisplayName : (auth.currentUser.displayName || 'User');
    const safePhoto = auth.currentUser.photoURL || 'https://via.placeholder.com/150';
    db.ref(`message_requests/${friendUid}/${myUid}`).set({
        senderId: myUid,
        senderName: safeName,
        senderPhoto: safePhoto,
        text: text,
        timestamp: Date.now()
    }).catch(err => console.error("Message error:", err));

    input.value = '';
}

function openSocialHub() {
    document.getElementById('lobbyView').style.display = 'none';
    document.getElementById('socialHubView').style.display = 'block';
}

function closeSocialHub() {
    document.getElementById('socialHubView').style.display = 'none';
    document.getElementById('lobbyView').style.display = 'block';
}
// --- MESSAGE REQUEST PROTOCOL ---



// ==========================================
// IN-ROOM FILE CABINET (RESOURCE DRAWER)
// ==========================================
let sessionResources = [];

function addResourceToCabinet(name, type, data, icon) {
    // Prevent duplicates (like the same link twice)
    if (sessionResources.some(r => r.data === data)) return;
    
    sessionResources.push({ name, type, data, icon });
    
    const list = document.getElementById('resourceCabinetList');
    if (sessionResources.length === 1) list.innerHTML = ''; // Clear empty message
    
    let actionBtn = '';
    if (type === 'link' || type === 'youtube') {
        actionBtn = `<a href="${data}" target="_blank" class="btn-secondary" style="padding:5px 10px; font-size:0.7rem; text-decoration:none;">Open</a>`;
    } else if (type === 'file' || type === 'image') {
        actionBtn = `<a href="${data}" download="${name}" class="btn" style="padding:5px 10px; font-size:0.7rem; text-decoration:none; color:white;">Save</a>`;
    }
    
    list.innerHTML += `
        <div style="background:#050505; border:1px solid var(--border-color); padding:12px; border-radius:4px; display:flex; justify-content:space-between; align-items:center;">
            <div style="display:flex; align-items:center; gap:10px; overflow:hidden; padding-right:10px;">
                <i class="${icon}" style="color:var(--accent); font-size:1.2rem;"></i>
                <span style="color:var(--text-light); font-size:0.8rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${name}">${name}</span>
            </div>
            <div>${actionBtn}</div>
        </div>
    `;
    
    logSystemMsg(`Resource cataloged: ${name}`);
    
    // Flash the cabinet icon red to notify users of a new file
    const cabBtn = document.getElementById('btn-cabinet');
    if (cabBtn) {
        cabBtn.style.color = 'var(--accent)';
        setTimeout(() => cabBtn.style.color = '', 3000);
    }
}
// ==========================================
// AUTOMATED MEETING DIGEST EXPORT
// ==========================================
function exportMeetingDigest() {
    let digest = `==========================================\n`;
    digest += `      SUPERROOM PRO - MEETING DIGEST      \n`;
    digest += `==========================================\n\n`;
    digest += `Date: ${new Date().toLocaleString()}\n`;
    digest += `Space ID: ${document.getElementById('uiShortId').innerText}\n\n`;

    digest += `[ ATTENDEES ]\n`;
    if (typeof roomMembers !== 'undefined') {
        roomMembers.forEach(m => {
            digest += `> ${m.name} ${m.isHost ? '(Host)' : ''}\n`;
        });
    }
    
    digest += `\n[ CATALOGED RESOURCES ]\n`;
    if (typeof sessionResources !== 'undefined' && sessionResources.length > 0) {
        sessionResources.forEach(r => {
            let rType = r.type.toUpperCase();
            digest += `> [${rType}] ${r.name}\n`;
            
            // If it's a website or YouTube video, print the actual URL so it can be clicked later!
            if (r.type === 'link' || r.type === 'youtube') {
                digest += `  URL: ${r.data}\n`;
            }
        });
    } else {
        digest += `> No files or links were shared during this session.\n`;
    }

    digest += `\n==========================================\n`;
    digest += `End of Digest.\n`;

    // Package the text into a downloadable file
    const blob = new Blob([digest], {type: 'text/plain'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `SuperRoom_Digest_${Date.now()}.txt`;
    a.click();
    
    logSystemMsg("Meeting Digest Exported.");
}
function requestCamOn(targetId) {
    if (!isHost) return;
    broadcastData({ type: 'request-cam-on', targetId: targetId });
    logSystemMsg(`Sent camera request to participant.`);
}

function forceCamOff(targetId) {
    if (!isHost) return;
    broadcastData({ type: 'force-cam-off-user', targetId: targetId });
    logSystemMsg(`Forced camera off for participant.`);
}
function acceptCamRequest() {
    document.getElementById('camRequestModal').style.display = 'none';
    const camBtn = document.getElementById('camBtn');
    if (!camBtn.classList.contains('active')) camBtn.click();
}
function lockAllHardware(state) {
    if (!isHost) return;
    broadcastData({ type: 'hardware-lock-state', targetId: 'all', state: state });
    logSystemMsg(state ? "Locked all participants' hardware." : "Unlocked all participants' hardware.");
}

let lockedUsers = {};

function toggleHardwareLock(targetId) {
    if (!isHost) return;
    
    // Flip the specific user's lock state back and forth
    lockedUsers[targetId] = !lockedUsers[targetId];
    
    broadcastData({ type: 'hardware-lock-state', targetId: targetId, state: lockedUsers[targetId] });
    logSystemMsg(lockedUsers[targetId] ? "Locked hardware for participant." : "Unlocked hardware for participant.");
}

// ==========================================






// ==========================================
// NEW MUTUAL-FRIEND SOCIAL ENGINE
// ==========================================
let myFollowing = {};
let myFollowers = {};
let myMessageRequests = {};

function initSocialEngine(myUid) {
    db.ref(`following/${myUid}`).on('value', snap => {
        myFollowing = snap.val() || {};
        renderSocialLists();
    });
    
    db.ref(`followers/${myUid}`).on('value', snap => {
        myFollowers = snap.val() || {};
        renderSocialLists();
    });

    db.ref(`message_requests/${myUid}`).on('value', snap => {
        myMessageRequests = snap.val() || {};
        renderSocialLists();
    });
}

function renderSocialLists() {
    const friendsList = document.getElementById('friendsList');
    const followingList = document.getElementById('followingList');
    const requestsList = document.getElementById('messageRequestsList');
    
    if (!friendsList || !followingList || !requestsList) return;

    friendsList.innerHTML = '';
    followingList.innerHTML = '';
    requestsList.innerHTML = '';

    let friendsCount = 0;
    let followingCount = 0;
    let requestsCount = 0;

    Object.values(myFollowing).forEach(user => {
        if (myFollowers[user.uid]) {
            friendsCount++;
            friendsList.appendChild(createSocialRow(user, 'friend'));
        } else {
            followingCount++;
            followingList.appendChild(createSocialRow(user, 'following'));
        }
    });

    Object.values(myFollowers).forEach(user => {
        if (!myFollowing[user.uid]) {
            requestsCount++;
            // Check if there is ALSO a message request from this follower
            if (myMessageRequests && myMessageRequests[user.uid]) {
                const combinedUser = { ...user, text: myMessageRequests[user.uid].text };
                requestsList.appendChild(createSocialRow(combinedUser, 'msg_request'));
                myMessageRequests[user.uid].rendered = true; // Mark as rendered
            } else {
                requestsList.appendChild(createSocialRow(user, 'request'));
            }
        }
    });

    Object.values(myMessageRequests).forEach(msgReq => {
        if (msgReq.rendered) return; // Already handled above
        
        const isMutual = myFollowing && myFollowing[msgReq.senderId] && myFollowers && myFollowers[msgReq.senderId];
        if (!isMutual) {
            requestsCount++;
            const userLikeObj = {
                uid: msgReq.senderId,
                displayName: msgReq.senderName,
                photoURL: msgReq.senderPhoto,
                text: msgReq.text
            };
            requestsList.appendChild(createSocialRow(userLikeObj, 'msg_request'));
        }
    });

    if (friendsCount === 0) friendsList.innerHTML = '<p class="empty-state">No mutual friends yet.</p>';
    if (followingCount === 0) followingList.innerHTML = '<p class="empty-state">You are not following anyone.</p>';
    if (requestsCount === 0) requestsList.innerHTML = '<p class="empty-state">No pending requests.</p>';
    
    const socialBtn = document.querySelector('button[onclick="openSocialHub()"]');
    if (socialBtn) {
        if (requestsCount > 0) {
            socialBtn.style.border = '2px solid #ff4444';
            socialBtn.textContent = 'Friends & Chats (' + requestsCount + ')';
        } else {
            socialBtn.style.border = 'none';
            socialBtn.textContent = 'Friends & Chats';
        }
    }
}

function createSocialRow(user, type) {
    const safeName = window.DOMPurify ? DOMPurify.sanitize(user.displayName, {ALLOWED_TAGS:[]}) : user.displayName.replace(/[<>]/g, '');
    const photoStr = user.photoURL || 'https://via.placeholder.com/150';
    
    const row = document.createElement('div');
    row.className = 'user-row';
    
    const info = document.createElement('div');
    info.className = 'user-row-info';
    info.innerHTML = `<img src="${photoStr}" class="user-avatar"><span style="color:#fff; font-size:0.8rem;">${safeName}</span>`;
    
    const btns = document.createElement('div');
    btns.style.display = 'flex';
    btns.style.gap = '4px';
    
    if (type === 'friend') {
        const btnChat = document.createElement('button');
        btnChat.className = 'btn';
        btnChat.style.cssText = 'padding:4px 8px; font-size:0.7rem;';
        btnChat.textContent = 'Chat';
        btnChat.addEventListener('click', () => {
            openDirectChat(user.uid, safeName);
            document.getElementById('directChatContainer').scrollIntoView({behavior: 'smooth', block: 'nearest'});
        });
        
        const btnRemove = document.createElement('button');
        btnRemove.className = 'btn-danger';
        btnRemove.style.cssText = 'padding:4px 8px; font-size:0.7rem;';
        btnRemove.textContent = 'Remove';
        btnRemove.addEventListener('click', () => removeFriend(user.uid));
        
        btns.appendChild(btnChat);
        btns.appendChild(btnRemove);
    } else if (type === 'following') {
        const btnUnfollow = document.createElement('button');
        btnUnfollow.className = 'btn-danger';
        btnUnfollow.style.cssText = 'padding:4px 8px; font-size:0.7rem;';
        btnUnfollow.textContent = 'Unfollow';
        btnUnfollow.addEventListener('click', () => unfollowUser(user.uid));
        btns.appendChild(btnUnfollow);
    } else if (type === 'request') {
        const btnAccept = document.createElement('button');
        btnAccept.className = 'btn';
        btnAccept.style.cssText = 'padding:4px 8px; font-size:0.7rem;';
        btnAccept.textContent = 'Follow Back';
        btnAccept.addEventListener('click', () => {
            followUser(user.uid, safeName, photoStr);
            const myUid = auth.currentUser.uid;
            const myName = typeof myDisplayName !== 'undefined' ? myDisplayName : (auth.currentUser.displayName || 'User');
            const myPhoto = auth.currentUser.photoURL || 'https://via.placeholder.com/150';
            db.ref(`following/${user.uid}/${myUid}`).set({ uid: myUid, displayName: myName, photoURL: myPhoto });
            db.ref(`followers/${myUid}/${user.uid}`).set({ uid: user.uid, displayName: safeName, photoURL: photoStr });
        });
        
        const btnRemove = document.createElement('button');
        btnRemove.className = 'btn-danger';
        btnRemove.style.cssText = 'padding:4px 8px; font-size:0.7rem;';
        btnRemove.textContent = 'Remove';
        btnRemove.addEventListener('click', () => removeFollower(user.uid));
        
        btns.appendChild(btnAccept);
        btns.appendChild(btnRemove);
    } else if (type === 'msg_request') {
        info.innerHTML = `<img src="${photoStr}" class="user-avatar">
                          <div style="display:flex; flex-direction:column; justify-content:center;">
                              <span style="color:#fff; font-size:0.8rem;">${safeName}</span>
                              <span style="color:#ffaa00; font-size:0.6rem; font-style:italic;">New Message!</span>
                          </div>`;
                          
        const btnAccept = document.createElement('button');
        btnAccept.className = 'btn';
        btnAccept.style.cssText = 'padding:4px 8px; font-size:0.7rem;';
        btnAccept.textContent = 'Accept & Chat';
        btnAccept.addEventListener('click', () => {
            followUser(user.uid, safeName, photoStr);
            const myUid = auth.currentUser.uid;
            const myName = typeof myDisplayName !== 'undefined' ? myDisplayName : (auth.currentUser.displayName || 'User');
            const myPhoto = auth.currentUser.photoURL || 'https://via.placeholder.com/150';
            db.ref(`following/${user.uid}/${myUid}`).set({ uid: myUid, displayName: myName, photoURL: myPhoto });
            db.ref(`followers/${myUid}/${user.uid}`).set({ uid: user.uid, displayName: safeName, photoURL: photoStr });
            
            db.ref(`message_requests/${auth.currentUser.uid}/${user.uid}`).remove();
            openDirectChat(user.uid, safeName);
            document.getElementById('directChatContainer').scrollIntoView({behavior: 'smooth', block: 'nearest'});
        });
        
        const btnRemove = document.createElement('button');
        btnRemove.className = 'btn-danger';
        btnRemove.style.cssText = 'padding:4px 8px; font-size:0.7rem;';
        btnRemove.textContent = 'Delete';
        btnRemove.addEventListener('click', () => {
            db.ref(`message_requests/${auth.currentUser.uid}/${user.uid}`).remove();
        });
        
        btns.appendChild(btnAccept);
        btns.appendChild(btnRemove);
    }
    
    row.appendChild(info);
    row.appendChild(btns);
    return row;
}

function followUser(targetUid, targetName, targetPhoto) {
    const myUid = auth.currentUser.uid;
    const safeName = typeof myDisplayName !== 'undefined' ? myDisplayName : (auth.currentUser.displayName || 'User');
    const safePhoto = auth.currentUser.photoURL || 'https://via.placeholder.com/150';

    const cleanTargetName = targetName || 'User';
    const cleanTargetPhoto = targetPhoto || 'https://via.placeholder.com/150';

    db.ref(`following/${myUid}/${targetUid}`).set({ uid: targetUid, displayName: cleanTargetName, photoURL: cleanTargetPhoto })
        .catch(err => console.error("Firebase Following Write Error:", err));
    db.ref(`followers/${targetUid}/${myUid}`).set({ uid: myUid, displayName: safeName, photoURL: safePhoto })
        .catch(err => console.error("Follow error:", err));
}

function unfollowUser(targetUid) {
    const myUid = auth.currentUser.uid;
    db.ref(`following/${myUid}/${targetUid}`).remove();
    db.ref(`followers/${targetUid}/${myUid}`).remove();
}

function removeFollower(followerUid) {
    const myUid = auth.currentUser.uid;
    db.ref(`followers/${myUid}/${followerUid}`).remove();
    db.ref(`following/${followerUid}/${myUid}`).remove();
}


function removeFriend(targetUid) {
    const myUid = auth.currentUser.uid;
    db.ref(`following/${myUid}/${targetUid}`).remove();
    db.ref(`followers/${targetUid}/${myUid}`).remove();
    db.ref(`following/${targetUid}/${myUid}`).remove();
    db.ref(`followers/${myUid}/${targetUid}`).remove();
}



// ==========================================
// ADMIN CONTROL PANEL
// ==========================================
const ADMIN_UID = "Tcv0e29OgwfyfgoPfR9zYskkV3w2"; // <-- YOU MUST PASTE YOUR FIREBASE UID HERE

function checkAdminStatus(uid) {
    if (uid === ADMIN_UID) {
        const btn = document.getElementById('adminBtn');
        if (btn) btn.style.display = 'block';
    }
}

function openAdminDashboard() {
    document.getElementById('lobbyView').style.display = 'none';
    document.getElementById('adminDashboardView').style.display = 'block';
    loadAdminUsers();
}

function closeAdminDashboard() {
    document.getElementById('adminDashboardView').style.display = 'none';
    document.getElementById('lobbyView').style.display = 'block';
}

function loadAdminUsers() {
    const container = document.getElementById('adminUserList');
    container.innerHTML = '<p style="color:#aaa;">Loading database...</p>';
    
    db.ref('users').once('value', snap => {
        const users = snap.val();
        if(!users) {
            container.innerHTML = '<p style="color:#aaa;">No users found.</p>';
            return;
        }
        
        db.ref('banned_users').once('value', bannedSnap => {
            const banned = bannedSnap.val() || {};
            container.innerHTML = '';
            
            Object.values(users).forEach(u => {
                const isBanned = !!banned[u.uid];
                const row = document.createElement('div');
                row.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 12px; border-bottom: 1px solid #333; background: ' + (isBanned ? '#3a0000' : 'transparent') + ';';
                
                const safeName = window.DOMPurify ? DOMPurify.sanitize(u.displayName, {ALLOWED_TAGS:[]}) : u.displayName.replace(/[<>]/g, '');
                const safePhoto = u.photoURL || 'https://via.placeholder.com/150';
                
                row.innerHTML = `
                    <div style="display:flex; align-items:center;">
                        <img src="${safePhoto}" style="width:40px; height:40px; border-radius:50%; object-fit:cover; margin-right:15px; border: 1px solid #555;">
                        <div style="display:flex; flex-direction:column;">
                            <span style="color:#fff; font-weight:bold; font-size:0.95rem;">${safeName} ${isBanned ? '<span style="color:#ff4444; font-size:0.7rem; padding-left:5px;">(BANNED)</span>' : ''}</span>
                            <span style="color:#666; font-size:0.75rem; font-family:monospace;">UID: ${u.uid}</span>
                        </div>
                    </div>
                `;
                
                if (u.uid !== ADMIN_UID) {
                    const btn = document.createElement('button');
                    btn.className = isBanned ? 'btn' : 'btn-danger';
                    btn.style.padding = '6px 12px';
                    btn.style.fontSize = '0.75rem';
                    btn.innerHTML = isBanned ? '<i class="fas fa-undo"></i> Unban' : '<i class="fas fa-ban"></i> Ban';
                    btn.onclick = () => toggleBanStatus(u.uid, !isBanned);
                    row.appendChild(btn);
                } else {
                    const badge = document.createElement('span');
                    badge.style.cssText = 'color:#ffaa00; font-size:0.8rem; font-weight:bold;';
                    badge.textContent = 'ADMIN';
                    row.appendChild(badge);
                }
                
                container.appendChild(row);
            });
        });
    });
}

function toggleBanStatus(targetUid, ban) {
    if (ban) {
        db.ref(`banned_users/${targetUid}`).set(true).then(loadAdminUsers);
    } else {
        db.ref(`banned_users/${targetUid}`).remove().then(loadAdminUsers);
    }
}


// ==========================================
// PRIORITY: MOBILE WEBRTC UNFREEZE & AUTO-RESUME
// Mobile OSes (Android/iOS) aggressively pause <video> elements when the browser 
// loses focus (e.g. answering a call, or triggering a screen-record prompt).
// This global listener forces all remote cameras to wake back up!
// ==========================================
document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === 'visible') {
        document.querySelectorAll('video').forEach(v => {
            if (v.paused && v.srcObject) {
                console.log("Auto-resuming frozen video element...");
                v.play().catch(e => console.warn("Could not auto-resume video:", e));
            }
        });
    }
});

window.addEventListener("focus", () => {
    document.querySelectorAll('video').forEach(v => {
        if (v.paused && v.srcObject) {
            v.play().catch(e => console.warn("Could not auto-resume video:", e));
        }
    });
});