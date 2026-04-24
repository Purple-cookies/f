// ============================ ХРАНЕНИЕ ============================
const STORAGE_USERS = 'eco_users_v38';
const STORAGE_CURRENT = 'eco_currentUser_v38';
const DEFAULT_AVATAR = 'https://ui-avatars.com/api/?background=2e7d32&color=fff&bold=true&size=120&rounded=true';
const FORBIDDEN_NAMES = ['говно', 'негр', 'телеграм', 'ютуб', 'расист', 'путин', 'гей', 'лесби', 'лгбт'];

let users = [];
let currentUser = null;
let isAdmin = false;
let currentPeriod = 'week';
let mapInstance = null;
let currentChatFriendId = null;

// ============================ ВСПОМОГАТЕЛЬНЫЕ ============================
function formatPhone(p) { return p.replace(/[^0-9]/g, ''); }
function maskPhone(p) { if (!p) return '****'; const c = p.replace(/[^0-9]/g, ''); return c.length < 4 ? '****' : '****' + c.slice(-4); }
function isValidPhone(p) { const c = p.replace(/[^0-9]/g, ''); return c.length >= 10 && c.length <= 12; }
function isNameForbidden(n) { return FORBIDDEN_NAMES.some(f => n.toLowerCase().trim() === f.toLowerCase()); }
function isNameUnique(n, id = null) { return !users.some(u => u.name.toLowerCase() === n.toLowerCase() && u.id !== id); }
function generateId() { return Date.now() + '-' + Math.random().toString(36).substr(2, 8); }
function escapeHtml(s) { if (!s) return ''; return s.replace(/[&<>]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[m])); }

function saveUsers() { localStorage.setItem(STORAGE_USERS, JSON.stringify(users)); }
function loadUsers() { const s = localStorage.getItem(STORAGE_USERS); users = s ? JSON.parse(s) : []; }
function saveCurrentUser() { currentUser ? localStorage.setItem(STORAGE_CURRENT, JSON.stringify({ id: currentUser.id })) : localStorage.removeItem(STORAGE_CURRENT); }
function loadCurrentUser() { const s = localStorage.getItem(STORAGE_CURRENT); if (s && users.length) { const { id } = JSON.parse(s); const u = users.find(u => u.id === id); if (u && !u.isBlocked) currentUser = u; } }

// ============================ РЕГИСТРАЦИЯ ============================
function registerUser(phone, name, password) {
    const p = formatPhone(phone);
    if (!isValidPhone(phone)) return { success: false, error: 'invalidPhone' };
    if (users.find(u => u.phone === p)) return { success: false, error: 'phoneExists' };
    if (isNameForbidden(name)) return { success: false, error: 'forbidden' };
    if (!isNameUnique(name)) return { success: false, error: 'notUnique' };
    if (password.length < 3) return { success: false, error: 'shortPassword' };
    
    const newUser = {
        id: generateId(),
        name: name.trim(),
        phone: p,
        password: password,
        totalWeight: 0,
        fractions: { plastic: 0, paper: 0, metal: 0, glass: 0 },
        weightHistory: [],
        isBlocked: false,
        registeredAt: new Date().toISOString(),
        lastLogin: new Date().toISOString(),
        avatar: DEFAULT_AVATAR,
        friends: [],
        friendRequests: [],
        chats: {}
    };
    users.push(newUser);
    saveUsers();
    return { success: true, user: newUser };
}

function loginUser(phone, password) {
    const p = formatPhone(phone);
    const u = users.find(u => u.phone === p);
    if (!u) return { success: false, error: 'notFound' };
    if (u.isBlocked) return { success: false, error: 'blocked' };
    if (u.password !== password) return { success: false, error: 'wrongPassword' };
    u.lastLogin = new Date().toISOString();
    saveUsers();
    return { success: true, user: u };
}

// ============================ ВЕС ============================
function addWeight(userId, fraction, weight) {
    if (!isAdmin) return false;
    const u = users.find(u => u.id === userId);
    if (!u || u.isBlocked) return false;
    weight = parseFloat(weight);
    if (isNaN(weight) || weight <= 0) return false;
    u.weightHistory.push({ id: generateId(), date: new Date().toISOString(), fraction: fraction, weight: weight });
    u.fractions[fraction] = (u.fractions[fraction] || 0) + weight;
    u.totalWeight = Object.values(u.fractions).reduce((s, v) => s + v, 0);
    saveUsers();
    return true;
}

function deleteWeight(userId, entryId) {
    if (!isAdmin) return false;
    const u = users.find(u => u.id === userId);
    if (!u) return false;
    const idx = u.weightHistory.findIndex(e => e.id === entryId);
    if (idx === -1) return false;
    const e = u.weightHistory[idx];
    u.fractions[e.fraction] = Math.max(0, (u.fractions[e.fraction] || 0) - e.weight);
    u.totalWeight = Object.values(u.fractions).reduce((s, v) => s + v, 0);
    u.weightHistory.splice(idx, 1);
    saveUsers();
    return true;
}

function editWeight(userId, entryId, newWeight) {
    if (!isAdmin) return false;
    const u = users.find(u => u.id === userId);
    if (!u) return false;
    const idx = u.weightHistory.findIndex(e => e.id === entryId);
    if (idx === -1) return false;
    const old = u.weightHistory[idx];
    newWeight = parseFloat(newWeight);
    if (isNaN(newWeight) || newWeight < 0) return false;
    const diff = newWeight - old.weight;
    u.fractions[old.fraction] = Math.max(0, (u.fractions[old.fraction] || 0) + diff);
    u.totalWeight = Object.values(u.fractions).reduce((s, v) => s + v, 0);
    u.weightHistory[idx].weight = newWeight;
    saveUsers();
    return true;
}

function blockUser(id) {
    if (!isAdmin) return false;
    const u = users.find(u => u.id === id);
    if (!u) return false;
    u.isBlocked = true;
    saveUsers();
    if (currentUser && currentUser.id === id) {
        currentUser = null;
        saveCurrentUser();
        updateAuthUI();
        showPage('registerPage');
    }
    renderRating();
    return true;
}

function unblockUser(id) {
    if (!isAdmin) return false;
    const u = users.find(u => u.id === id);
    if (!u) return false;
    u.isBlocked = false;
    saveUsers();
    renderRating();
    return true;
}

function getActive() { return users.filter(u => !u.isBlocked); }

// ============================ РЕЙТИНГ ============================
function getWeightForPeriod(user, period) {
    if (period === 'alltime') return user.totalWeight;
    const start = new Date();
    start.setDate(start.getDate() - (period === 'week' ? 7 : 30));
    let total = 0;
    for (const e of user.weightHistory) {
        if (new Date(e.date) >= start) total += e.weight;
    }
    return total;
}

function getFractionsForPeriod(user, period) {
    if (period === 'alltime') return { ...user.fractions };
    const start = new Date();
    start.setDate(start.getDate() - (period === 'week' ? 7 : 30));
    const res = { plastic: 0, paper: 0, metal: 0, glass: 0 };
    for (const e of user.weightHistory) {
        if (new Date(e.date) >= start) res[e.fraction] += e.weight;
    }
    return res;
}

function getLastDonation(user) {
    if (!user.weightHistory || !user.weightHistory.length) return null;
    return [...user.weightHistory].sort((a, b) => new Date(b.date) - new Date(a.date))[0];
}

function getExpiry(user, period) {
    if (period === 'alltime') return null;
    const last = getLastDonation(user);
    if (!last) return { expired: true, message: 'Нет активности' };
    const days = Math.ceil((new Date() - new Date(last.date)) / (1000 * 60 * 60 * 24));
    const limit = period === 'week' ? 7 : 30;
    if (days > limit) return { expired: true, message: 'Исчез (' + days + ' дн.)' };
    return { expired: false, daysLeft: limit - days, message: (limit - days) + ' дн.' };
}

function getSortedUsers(period) {
    const active = getActive();
    const withW = active.map(u => ({
        ...u,
        periodWeight: getWeightForPeriod(u, period),
        periodFractions: getFractionsForPeriod(u, period),
        expiry: getExpiry(u, period)
    }));
    let filtered = withW;
    if (period !== 'alltime') {
        filtered = withW.filter(u => u.periodWeight > 0 || (u.expiry && !u.expiry.expired));
    }
    return filtered.sort((a, b) => b.periodWeight - a.periodWeight);
}

function renderRating() {
    const tbody = document.getElementById('ratingTableBody');
    if (!tbody) return;
    const sorted = getSortedUsers(currentPeriod);
    if (!sorted.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center py-5 text-muted">Нет активных пользователей</td></tr>';
        return;
    }
    tbody.innerHTML = sorted.map((u, i) => {
        const showFull = currentUser && (currentUser.id === u.id || isAdmin);
        const phone = showFull ? u.phone : maskPhone(u.phone);
        const f = u.periodFractions;
        let badge = '';
        if (currentPeriod !== 'alltime' && u.expiry && !u.expiry.expired && u.expiry.daysLeft <= 3) {
            badge = '<span class="badge bg-warning ms-2">Скоро исчезнет</span>';
        }
        return `<tr class="user-row" data-user-id="${u.id}" style="cursor:pointer">
            <td><span class="user-badge">#${i + 1}</span></td>
            <td>
                <div class="rating-user-cell" style="display:flex;align-items:center;gap:10px">
                    <img src="${u.avatar || DEFAULT_AVATAR}" style="width:32px;height:32px;border-radius:50%;object-fit:cover">
                    <div>
                        <strong>${escapeHtml(u.name)}</strong>
                        ${currentUser && currentUser.id === u.id ? '<span class="badge bg-success ms-1">Вы</span>' : ''}
                        ${badge}
                        <br><small class="phone-hidden">${phone}</small>
                    </div>
                </div>
                </td>
            <td class="fw-bold">${u.periodWeight.toFixed(2)} кг</td>
            <td class="d-none d-sm-table-cell">${f.plastic.toFixed(1)} кг</td>
            <td class="d-none d-sm-table-cell">${f.paper.toFixed(1)} кг</td>
            <td class="d-none d-sm-table-cell">${f.metal.toFixed(1)} кг</td>
            <td class="d-none d-sm-table-cell">${f.glass.toFixed(1)} кг</td>
        </tr>`;
    }).join('');
    
    document.querySelectorAll('.user-row').forEach(r => r.addEventListener('click', (e) => {
        e.stopPropagation();
        showUserInfo(r.dataset.userId);
    }));
}

// ============================ ПАНЕЛЬ ИНФО ============================
function showUserInfo(id) {
    const u = users.find(u => u.id === id);
    if (!u) return;
    const last = getLastDonation(u);
    const expiry = getExpiry(u, currentPeriod);
    document.getElementById('panelUserName').textContent = u.name;
    if (last) {
        document.getElementById('lastDonationDate').textContent = new Date(last.date).toLocaleDateString('ru-RU');
        document.getElementById('lastDonationWeight').textContent = last.weight + ' кг';
        const f = { plastic: 'Пластик', paper: 'Бумага', metal: 'Металл', glass: 'Стекло' };
        document.getElementById('lastDonationFraction').textContent = f[last.fraction];
    } else {
        document.getElementById('lastDonationDate').textContent = 'Нет данных';
        document.getElementById('lastDonationWeight').textContent = '0 кг';
        document.getElementById('lastDonationFraction').textContent = '-';
    }
    document.getElementById('expiryTimer').textContent = expiry ? expiry.message : '-';
    document.getElementById('userInfoPanel').style.display = 'block';
}

function hideUserInfo() {
    document.getElementById('userInfoPanel').style.display = 'none';
}

// ============================ АДМИН ============================
function updateAdminSelects() {
    const active = getActive();
    const sel = document.getElementById('adminUserSelect');
    if (sel) {
        sel.innerHTML = '<option value="">Выберите пользователя</option>' + active.map(u => `<option value="${u.id}">${escapeHtml(u.name)} (${u.phone})</option>`).join('');
    }
    const block = document.getElementById('adminBlockUserSelect');
    if (block) {
        block.innerHTML = '<option value="">Заблокировать</option>' + active.map(u => `<option value="${u.id}">${escapeHtml(u.name)} (${u.phone})</option>`).join('');
    }
    const unblock = document.getElementById('adminUnblockUserSelect');
    if (unblock) {
        unblock.innerHTML = '<option value="">Разблокировать</option>' + users.filter(u => u.isBlocked).map(u => `<option value="${u.id}">${escapeHtml(u.name)} (${u.phone})</option>`).join('');
    }
}

function updateWeightHistory() {
    const uid = document.getElementById('adminUserSelect') ? document.getElementById('adminUserSelect').value : '';
    const hist = document.getElementById('adminWeightHistorySelect');
    if (!uid || !hist) return;
    const u = users.find(u => u.id === uid);
    if (!u || !u.weightHistory.length) {
        hist.innerHTML = '<option value="">Нет записей</option>';
        return;
    }
    const f = { plastic: 'Пластик', paper: 'Бумага', metal: 'Металл', glass: 'Стекло' };
    const sorted = [...u.weightHistory].sort((a, b) => new Date(b.date) - new Date(a.date));
    hist.innerHTML = '<option value="">Выберите запись</option>' + sorted.map(e => `<option value="${e.id}">${new Date(e.date).toLocaleDateString()} - ${f[e.fraction]}: ${e.weight} кг</option>`).join('');
}

function renderAdminPanel() {
    const panel = document.getElementById('adminPanel');
    const btn = document.getElementById('adminLoginBtn');
    if (isAdmin && currentUser) {
        if (panel) panel.style.display = 'flex';
        if (btn) {
            btn.innerHTML = '<i class="fas fa-crown me-1"></i> Администратор';
            btn.classList.add('admin-mode');
        }
        updateAdminSelects();
    } else {
        if (panel) panel.style.display = 'none';
        if (btn) {
            btn.innerHTML = '<i class="fas fa-lock me-1"></i> вход для администрации';
            btn.classList.remove('admin-mode');
        }
    }
}

// ============================ ПРОФИЛЬ ============================
function renderProfile() {
    if (!currentUser) return;
    document.getElementById('profileName').textContent = currentUser.name;
    document.getElementById('profilePhone').textContent = maskPhone(currentUser.phone);
    document.getElementById('profileAvatar').src = currentUser.avatar || DEFAULT_AVATAR;
    document.getElementById('profileTotalWeight').textContent = currentUser.totalWeight.toFixed(1);
    document.getElementById('profileDonationsCount').textContent = currentUser.weightHistory.length;
    const rank = getSortedUsers('alltime').findIndex(u => u.id === currentUser.id) + 1;
    document.getElementById('profileRank').textContent = rank > 0 ? rank + ' место' : '-';
    
    const f = currentUser.fractions;
    document.getElementById('plasticWeight').textContent = (f.plastic || 0).toFixed(1) + ' кг';
    document.getElementById('paperWeight').textContent = (f.paper || 0).toFixed(1) + ' кг';
    document.getElementById('metalWeight').textContent = (f.metal || 0).toFixed(1) + ' кг';
    document.getElementById('glassWeight').textContent = (f.glass || 0).toFixed(1) + ' кг';
    
    // Полосы прогресса всегда пустые
    document.getElementById('plasticProgress').style.width = '0%';
    document.getElementById('paperProgress').style.width = '0%';
    document.getElementById('metalProgress').style.width = '0%';
    document.getElementById('glassProgress').style.width = '0%';
    
    renderFriendsList();
    renderFriendRequests();
}

function renderFriendsList() {
    const container = document.getElementById('friendsList');
    if (!container) return;
    if (!currentUser || !currentUser.friends || currentUser.friends.length === 0) {
        container.innerHTML = '<div class="text-muted text-center py-3">У вас пока нет друзей</div>';
        return;
    }
    container.innerHTML = currentUser.friends.map(id => {
        const f = users.find(u => u.id === id);
        if (!f || f.isBlocked) return '';
        return `<div class="friend-item">
            <div class="friend-info">
                <img class="friend-avatar" src="${f.avatar || DEFAULT_AVATAR}">
                <div>
                    <div class="friend-name">${escapeHtml(f.name)}</div>
                    <div class="friend-status">${f.totalWeight} кг</div>
                </div>
            </div>
            <div class="friend-actions">
                <button class="chat-btn" data-friend-id="${f.id}"><i class="fas fa-comment-dots"></i></button>
                <button class="remove-btn" data-friend-id="${f.id}"><i class="fas fa-user-minus"></i></button>
            </div>
        </div>`;
    }).join('');
    document.querySelectorAll('.chat-btn').forEach(btn => btn.addEventListener('click', () => openChat(btn.dataset.friendId)));
    document.querySelectorAll('.remove-btn').forEach(btn => btn.addEventListener('click', () => {
        if (confirm('Удалить друга?')) {
            currentUser.friends = currentUser.friends.filter(id => id !== btn.dataset.friendId);
            saveUsers();
            renderFriendsList();
        }
    }));
}

function renderFriendRequests() {
    const container = document.getElementById('friendRequestsList');
    if (!container) return;
    if (!currentUser || !currentUser.friendRequests || currentUser.friendRequests.length === 0) {
        container.innerHTML = '<div class="text-muted text-center py-3">Нет заявок</div>';
        return;
    }
    container.innerHTML = currentUser.friendRequests.map(request => {
        const user = users.find(u => u.id === request.fromUserId);
        if (!user) return '';
        return `<div class="request-item">
            <div class="request-info">
                <img class="request-avatar" src="${user.avatar || DEFAULT_AVATAR}">
                <div>
                    <div class="request-name">${escapeHtml(user.name)}</div>
                    <div class="friend-status">хочет добавить вас в друзья</div>
                </div>
            </div>
            <div class="request-actions">
                <button class="accept-btn" data-request-id="${request.id}" data-user-id="${user.id}"><i class="fas fa-check-circle"></i></button>
                <button class="reject-btn" data-request-id="${request.id}"><i class="fas fa-times-circle"></i></button>
            </div>
        </div>`;
    }).join('');
    document.querySelectorAll('.accept-btn').forEach(btn => btn.addEventListener('click', () => {
        const fromUserId = btn.dataset.userId;
        const requestId = btn.dataset.requestId;
        if (!currentUser.friends) currentUser.friends = [];
        currentUser.friends.push(fromUserId);
        currentUser.friendRequests = currentUser.friendRequests.filter(r => r.id !== requestId);
        const fromUser = users.find(u => u.id === fromUserId);
        if (fromUser) {
            if (!fromUser.friends) fromUser.friends = [];
            if (!fromUser.friends.includes(currentUser.id)) fromUser.friends.push(currentUser.id);
        }
        saveUsers();
        renderFriendsList();
        renderFriendRequests();
        alert('Вы теперь друзья!');
    }));
    document.querySelectorAll('.reject-btn').forEach(btn => btn.addEventListener('click', () => {
        currentUser.friendRequests = currentUser.friendRequests.filter(r => r.id !== btn.dataset.requestId);
        saveUsers();
        renderFriendRequests();
    }));
}

function sendFriendRequest(toUserId) {
    const toUser = users.find(u => u.id === toUserId);
    if (!toUser) return false;
    if (!toUser.friendRequests) toUser.friendRequests = [];
    if (toUser.friendRequests.find(r => r.fromUserId === currentUser.id)) {
        alert('Заявка уже отправлена');
        return false;
    }
    toUser.friendRequests.push({
        id: generateId(),
        fromUserId: currentUser.id,
        fromUserName: currentUser.name,
        timestamp: new Date().toISOString()
    });
    saveUsers();
    alert('Заявка отправлена!');
    return true;
}

// ============================ ЧАТ ============================
function openChat(id) {
    const f = users.find(u => u.id === id);
    if (!f) return;
    currentChatFriendId = id;
    document.getElementById('chatFriendName').textContent = f.name;
    document.getElementById('chatModal').style.display = 'flex';
    if (!currentUser.chats) currentUser.chats = {};
    if (!currentUser.chats[id]) currentUser.chats[id] = [];
    renderChat();
}

function renderChat() {
    const container = document.getElementById('chatMessages');
    if (!container) return;
    const msgs = currentUser.chats[currentChatFriendId] || [];
    if (msgs.length === 0) {
        container.innerHTML = '<div class="text-muted text-center py-5">Нет сообщений</div>';
        return;
    }
    container.innerHTML = msgs.map(msg => {
        const sent = msg.senderId === currentUser.id;
        const time = new Date(msg.timestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
        return `<div class="chat-message ${sent ? 'sent' : 'received'}">
            <div class="message-bubble">
                ${escapeHtml(msg.text)}
                <span class="message-time">${time}</span>
            </div>
        </div>`;
    }).join('');
    container.scrollTop = container.scrollHeight;
}

function sendMessage() {
    const input = document.getElementById('chatMessageInput');
    const msg = input.value.trim();
    if (!msg || !currentChatFriendId) return;
    if (!currentUser.chats) currentUser.chats = {};
    if (!currentUser.chats[currentChatFriendId]) currentUser.chats[currentChatFriendId] = [];
    const newMsg = {
        id: generateId(),
        senderId: currentUser.id,
        receiverId: currentChatFriendId,
        text: msg,
        timestamp: new Date().toISOString()
    };
    currentUser.chats[currentChatFriendId].push(newMsg);
    const friend = users.find(u => u.id === currentChatFriendId);
    if (friend) {
        if (!friend.chats) friend.chats = {};
        if (!friend.chats[currentUser.id]) friend.chats[currentUser.id] = [];
        friend.chats[currentUser.id].push({ ...newMsg });
        saveUsers();
    }
    saveUsers();
    renderChat();
    input.value = '';
}

// ============================ ЗАГРУЗКА АВАТАРА ============================
let selectedFile = null;

function setupAvatarUpload() {
    const fileInput = document.getElementById('avatarUploadInput');
    const selectBtn = document.getElementById('selectFileBtn');
    const preview = document.getElementById('avatarPreview');
    const previewImg = document.getElementById('avatarPreviewImg');
    const confirmBtn = document.getElementById('confirmUploadBtn');
    const uploadModal = document.getElementById('uploadAvatarModal');
    if (selectBtn) selectBtn.addEventListener('click', () => fileInput.click());
    fileInput?.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file && file.type.startsWith('image/')) {
            selectedFile = file;
            const reader = new FileReader();
            reader.onload = (event) => {
                previewImg.src = event.target.result;
                preview.style.display = 'block';
                selectBtn.style.display = 'none';
            };
            reader.readAsDataURL(file);
        } else alert('Выберите изображение');
    });
    confirmBtn?.addEventListener('click', () => {
        if (selectedFile && currentUser) {
            const reader = new FileReader();
            reader.onload = (event) => {
                currentUser.avatar = event.target.result;
                saveUsers();
                renderProfile();
                renderRating();
                uploadModal.style.display = 'none';
                selectedFile = null;
                preview.style.display = 'none';
                selectBtn.style.display = 'block';
                fileInput.value = '';
                alert('Аватар обновлён!');
            };
            reader.readAsDataURL(selectedFile);
        }
    });
}

// ============================ UI ============================
function updateAuthUI() {
    const logged = document.getElementById('loggedInPanel');
    const reg = document.getElementById('registerContent');
    const login = document.getElementById('loginContent');
    const tabs = document.getElementById('authTab');
    if (currentUser && !currentUser.isBlocked) {
        if (logged) logged.style.display = 'block';
        document.getElementById('loggedUserName').textContent = currentUser.name;
        document.getElementById('loggedUserPhone').textContent = currentUser.phone;
        if (reg) reg.style.display = 'none';
        if (login) login.style.display = 'none';
        if (tabs) tabs.style.display = 'none';
        document.body.classList.add('user-authorized');
        renderProfile();
    } else {
        if (logged) logged.style.display = 'none';
        if (reg) reg.style.display = 'block';
        if (login) login.style.display = 'none';
        if (tabs) tabs.style.display = 'flex';
        document.body.classList.remove('user-authorized');
        const regTab = document.getElementById('register-tab-btn');
        const loginTab = document.getElementById('login-tab-btn');
        if (regTab) regTab.classList.add('active');
        if (loginTab) loginTab.classList.remove('active');
    }
}

function showWelcomeMessage() {
    const welcome = document.getElementById('welcomeMessage');
    const reg = document.getElementById('registerContent');
    const login = document.getElementById('loginContent');
    const logged = document.getElementById('loggedInPanel');
    if (welcome) {
        reg.style.display = 'none';
        login.style.display = 'none';
        logged.style.display = 'none';
        welcome.style.display = 'block';
        setTimeout(() => {
            welcome.style.display = 'none';
            if (logged && currentUser) logged.style.display = 'block';
        }, 5000);
    }
}

function showPage(id) {
    const pages = ['registerPage', 'profilePage', 'ratingPage', 'mapPage'];
    pages.forEach(p => { const el = document.getElementById(p); if (el) el.classList.remove('active'); });
    document.getElementById(id).classList.add('active');
    const links = document.querySelectorAll('.nav-link');
    links.forEach(l => l.classList.remove('active'));
    const idx = { registerPage: 0, profilePage: 1, ratingPage: 2, mapPage: 3 }[id];
    if (idx !== undefined && links[idx]) links[idx].classList.add('active');
    hideUserInfo();
    if (id === 'mapPage') setTimeout(() => { if (mapInstance) mapInstance.invalidateSize(); else initMap(); }, 100);
    if (id === 'ratingPage') renderRating();
    if (id === 'profilePage' && currentUser) renderProfile();
}

function initMap() {
    if (mapInstance) mapInstance.remove();
    mapInstance = L.map('interactiveMap').setView([61.2515, 73.4100], 17);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(mapInstance);
    L.marker([61.2515, 73.4100]).addTo(mapInstance).bindPopup('<b>Эко-Партнёр</b><br>ул. Чехова, 14/5<br>09:00-19:00');
    L.circle([61.2515, 73.4100], { color: '#2e7d32', fillColor: '#4caf50', fillOpacity: 0.2, radius: 100 }).addTo(mapInstance);
}

// ============================ ВЫХОД ============================
function showLogoutWarning() {
    const warningModal = document.createElement('div');
    warningModal.className = 'admin-modal';
    warningModal.style.display = 'flex';
    warningModal.innerHTML = `<div class="admin-modal-content" style="max-width: 450px;"><div class="modal-header" style="background: linear-gradient(135deg, #dc3545, #c82333);"><h4><i class="fas fa-exclamation-triangle me-2"></i>Внимание!</h4><span class="close-warning-modal" style="cursor:pointer">&times;</span></div><div class="modal-body"><div style="text-align: center; margin-bottom: 20px;"><i class="fas fa-hourglass-half" style="font-size: 48px; color: #ff9800;"></i></div><p class="text-center mb-3" style="font-size: 1.1rem;">⚠️ ВАЖНОЕ ПРЕДУПРЕЖДЕНИЕ! ⚠️</p><p class="text-center mb-3">Если вы выйдете из аккаунта, он будет автоматически <strong>удалён через 30 дней</strong> неактивности.</p><p class="text-center text-muted small mb-3">Чтобы сохранить аккаунт, просто заходите в него хотя бы раз в месяц.</p><div class="d-flex gap-2"><button id="cancelLogoutBtn" class="btn btn-secondary w-50">Отмена</button><button id="confirmLogoutBtn" class="btn btn-danger w-50">Выйти</button></div></div></div>`;
    document.body.appendChild(warningModal);
    const close = () => warningModal.remove();
    warningModal.querySelector('.close-warning-modal')?.addEventListener('click', close);
    warningModal.querySelector('#cancelLogoutBtn')?.addEventListener('click', close);
    warningModal.querySelector('#confirmLogoutBtn')?.addEventListener('click', () => { close(); performLogout(); });
    warningModal.addEventListener('click', (e) => { if (e.target === warningModal) close(); });
}

function performLogout() {
    currentUser = null;
    isAdmin = false;
    saveCurrentUser();
    updateAuthUI();
    renderAdminPanel();
    renderRating();
    hideUserInfo();
    
    // Очищаем все поля ввода на странице регистрации и входа
    const regPhone = document.getElementById('regPhone');
    const regName = document.getElementById('regName');
    const regPassword = document.getElementById('regPassword');
    const loginPhone = document.getElementById('loginPhone');
    const loginPassword = document.getElementById('loginPassword');
    
    if (regPhone) regPhone.value = '';
    if (regName) regName.value = '';
    if (regPassword) regPassword.value = '';
    if (loginPhone) loginPhone.value = '';
    if (loginPassword) loginPassword.value = '';
    
    // Сбрасываем активную вкладку на регистрацию
    const regTab = document.getElementById('register-tab-btn');
    const loginTab = document.getElementById('login-tab-btn');
    if (regTab && loginTab) {
        regTab.classList.add('active');
        loginTab.classList.remove('active');
    }
    
    // Убеждаемся, что видна форма регистрации, а не входа
    const registerContent = document.getElementById('registerContent');
    const loginContent = document.getElementById('loginContent');
    if (registerContent) registerContent.style.display = 'block';
    if (loginContent) loginContent.style.display = 'none';
    
    showPage('registerPage');
}

// ============================ ЗАПУСК ============================
document.addEventListener('DOMContentLoaded', function() {
    loadUsers();
    loadCurrentUser();
    updateAuthUI();
    renderAdminPanel();
    setupAvatarUpload();
    if (currentUser) showPage('ratingPage');
    else showPage('registerPage');
    if (document.getElementById('interactiveMap')?.offsetParent) setTimeout(initMap, 100);

    // Регистрация
    const registerBtn = document.getElementById('registerBtn');
    if (registerBtn) {
        const newBtn = registerBtn.cloneNode(true);
        registerBtn.parentNode.replaceChild(newBtn, registerBtn);
        newBtn.addEventListener('click', () => {
            const phone = document.getElementById('regPhone').value.trim();
            const name = document.getElementById('regName').value.trim();
            const pwd = document.getElementById('regPassword').value;
            if (!phone || !name || !pwd) { alert('Заполните все поля'); return; }
            if (pwd.length < 3) { alert('Пароль минимум 3 символа'); return; }
            if (!isValidPhone(phone)) { alert('Некорректный телефон'); return; }
            const res = registerUser(phone, name, pwd);
            if (!res.success) {
                const err = { phoneExists:'Телефон занят', forbidden:'Ник запрещён', notUnique:'Ник занят', shortPassword:'Короткий пароль', invalidPhone:'Неверный телефон' };
                alert(err[res.error] || 'Ошибка'); return;
            }
            currentUser = res.user;
            saveCurrentUser();
            updateAuthUI();
            renderRating();
            updateAdminSelects();
            showWelcomeMessage();
            showPage('ratingPage');
        });
    }

    // Вход
    const loginBtn = document.getElementById('loginBtn');
    if (loginBtn) {
        const newBtn = loginBtn.cloneNode(true);
        loginBtn.parentNode.replaceChild(newBtn, loginBtn);
        newBtn.addEventListener('click', () => {
            const phone = document.getElementById('loginPhone').value.trim();
            const pwd = document.getElementById('loginPassword').value;
            if (!phone || !pwd) { alert('Введите телефон и пароль'); return; }
            const res = loginUser(phone, pwd);
            if (!res.success) {
                const err = { notFound:'Пользователь не найден', blocked:'Заблокирован', wrongPassword:'Неверный пароль' };
                alert(err[res.error] || 'Ошибка'); return;
            }
            currentUser = res.user;
            saveCurrentUser();
            updateAuthUI();
            renderRating();
            updateAdminSelects();
            showPage('ratingPage');
        });
    }

    // Выход
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        const newBtn = logoutBtn.cloneNode(true);
        logoutBtn.parentNode.replaceChild(newBtn, logoutBtn);
        newBtn.addEventListener('click', showLogoutWarning);
    }

    // Админ
    const adminLoginBtn = document.getElementById('adminLoginBtn');
    if (adminLoginBtn) {
        const newBtn = adminLoginBtn.cloneNode(true);
        adminLoginBtn.parentNode.replaceChild(newBtn, adminLoginBtn);
        newBtn.addEventListener('click', () => document.getElementById('adminModal').style.display = 'flex');
    }
    document.querySelector('.close-modal')?.addEventListener('click', () => document.getElementById('adminModal').style.display = 'none');
    document.getElementById('submitAdminPassword')?.addEventListener('click', () => {
        if (document.getElementById('adminPasswordInput').value === '905906') {
            isAdmin = true;
            document.getElementById('adminModal').style.display = 'none';
            renderAdminPanel();
            renderRating();
            alert('Админ режим активирован');
        } else alert('Неверный код');
        document.getElementById('adminPasswordInput').value = '';
    });
    document.getElementById('closeAdminPanelBtn')?.addEventListener('click', () => { isAdmin = false; renderAdminPanel(); renderRating(); });

    // Управление весом
    document.getElementById('adminAddWeightBtn')?.addEventListener('click', () => {
        const uid = document.getElementById('adminUserSelect').value;
        const frac = document.getElementById('adminFractionSelect').value;
        const w = document.getElementById('adminWeight').value;
        const msg = document.getElementById('adminMessage');
        if (!uid) { msg.innerHTML = '<span class="text-danger">Выберите пользователя</span>'; setTimeout(() => msg.innerHTML = '', 2000); return; }
        if (addWeight(uid, frac, w)) {
            msg.innerHTML = '<span class="text-success">Добавлено!</span>';
            renderRating(); updateAdminSelects(); updateWeightHistory();
            document.getElementById('adminWeight').value = '';
            setTimeout(() => msg.innerHTML = '', 2000);
        }
    });
    document.getElementById('adminDeleteWeightBtn')?.addEventListener('click', () => {
        const uid = document.getElementById('adminUserSelect').value;
        const eid = document.getElementById('adminWeightHistorySelect').value;
        if (!eid) { document.getElementById('adminMessage').innerHTML = '<span class="text-danger">Выберите запись</span>'; return; }
        if (confirm('Удалить?')) { deleteWeight(uid, eid); renderRating(); updateAdminSelects(); updateWeightHistory(); }
    });
    document.getElementById('adminEditWeightBtn')?.addEventListener('click', () => {
        const uid = document.getElementById('adminUserSelect').value;
        const eid = document.getElementById('adminWeightHistorySelect').value;
        const nw = document.getElementById('adminEditWeight').value;
        if (!eid) { alert('Выберите запись'); return; }
        editWeight(uid, eid, nw); renderRating(); updateAdminSelects(); updateWeightHistory();
        document.getElementById('adminEditWeight').value = '';
    });
    document.getElementById('adminBlockBtn')?.addEventListener('click', () => {
        const uid = document.getElementById('adminBlockUserSelect').value;
        if (uid && confirm('Заблокировать?')) { blockUser(uid); renderRating(); updateAdminSelects(); updateWeightHistory(); }
    });
    document.getElementById('adminUnblockBtn')?.addEventListener('click', () => {
        const uid = document.getElementById('adminUnblockUserSelect').value;
        if (uid && confirm('Разблокировать?')) { unblockUser(uid); renderRating(); updateAdminSelects(); updateWeightHistory(); }
    });
    document.getElementById('adminUserSelect')?.addEventListener('change', updateWeightHistory);

    // Поиск
    document.getElementById('adminSearchBtn')?.addEventListener('click', () => {
        const term = document.getElementById('adminSearchInput').value;
        if (!term.trim()) return;
        const results = getActive().filter(u => u.name.toLowerCase().includes(term.toLowerCase()));
        const list = document.getElementById('searchResultsList');
        const div = document.getElementById('searchResults');
        list.innerHTML = results.length ? results.map(u => `<div class="search-result-item" data-user-id="${u.id}"><b>${escapeHtml(u.name)}</b> ${u.phone}<br><small>Вес: ${u.totalWeight} кг</small></div>`).join('') : '<div class="text-muted p-3">Не найдено</div>';
        div.style.display = 'block';
        document.querySelectorAll('.search-result-item').forEach(el => el.addEventListener('click', () => {
            document.getElementById('adminUserSelect').value = el.dataset.userId;
            updateWeightHistory();
            div.style.display = 'none';
        }));
    });
    document.getElementById('clearSearchBtn')?.addEventListener('click', () => {
        document.getElementById('adminSearchInput').value = '';
        document.getElementById('searchResults').style.display = 'none';
    });
    document.getElementById('closePanelBtn')?.addEventListener('click', hideUserInfo);

    // Периоды
    document.querySelectorAll('.period-btn').forEach(btn => {
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);
        newBtn.addEventListener('click', () => {
            document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
            newBtn.classList.add('active');
            currentPeriod = newBtn.dataset.period;
            renderRating();
            hideUserInfo();
        });
    });

    // Навигация
    document.querySelectorAll('.nav-link').forEach(link => {
        const newLink = link.cloneNode(true);
        link.parentNode.replaceChild(newLink, link);
        newLink.addEventListener('click', (e) => {
            e.preventDefault();
            const page = newLink.dataset.page;
            if (page === 'register') showPage('registerPage');
            else if (page === 'profile') showPage('profilePage');
            else if (page === 'rating') showPage('ratingPage');
            else if (page === 'map') showPage('mapPage');
        });
    });

    // Табы
    const regTab = document.getElementById('register-tab-btn');
    const loginTab = document.getElementById('login-tab-btn');
    if (regTab) {
        const newRegTab = regTab.cloneNode(true);
        regTab.parentNode.replaceChild(newRegTab, regTab);
        newRegTab.addEventListener('click', () => {
            document.getElementById('registerContent').style.display = 'block';
            document.getElementById('loginContent').style.display = 'none';
            newRegTab.classList.add('active');
            if (newLoginTab) newLoginTab.classList.remove('active');
        });
    }
    if (loginTab) {
        const newLoginTab = loginTab.cloneNode(true);
        loginTab.parentNode.replaceChild(newLoginTab, loginTab);
        newLoginTab.addEventListener('click', () => {
            document.getElementById('registerContent').style.display = 'none';
            document.getElementById('loginContent').style.display = 'block';
            newLoginTab.classList.add('active');
            if (newRegTab) newRegTab.classList.remove('active');
        });
    }

    // Смена ника
    const changeNickBtn = document.getElementById('changeNicknameBtn');
    if (changeNickBtn) {
        const newBtn = changeNickBtn.cloneNode(true);
        changeNickBtn.parentNode.replaceChild(newBtn, changeNickBtn);
        newBtn.addEventListener('click', () => document.getElementById('changeNicknameModal').style.display = 'flex');
    }
    document.querySelector('.close-modal-nick')?.addEventListener('click', () => document.getElementById('changeNicknameModal').style.display = 'none');
    document.getElementById('submitNicknameChange')?.addEventListener('click', () => {
        const newName = document.getElementById('newNicknameInput').value.trim();
        if (!newName) { alert('Введите новый ник'); return; }
        if (isNameForbidden(newName)) { alert('Ник запрещён'); return; }
        if (!isNameUnique(newName, currentUser?.id)) { alert('Ник занят'); return; }
        if (currentUser) {
            currentUser.name = newName;
            saveUsers(); saveCurrentUser(); updateAuthUI(); renderRating(); updateAdminSelects(); renderProfile();
            document.getElementById('changeNicknameModal').style.display = 'none';
            alert('Ник изменён');
        }
    });

    // Аватар
    const changeAvatarBtn = document.getElementById('changeAvatarBtn');
    if (changeAvatarBtn) {
        const newBtn = changeAvatarBtn.cloneNode(true);
        changeAvatarBtn.parentNode.replaceChild(newBtn, changeAvatarBtn);
        newBtn.addEventListener('click', () => {
            if (currentUser) document.getElementById('uploadAvatarModal').style.display = 'flex';
            else alert('Войдите в аккаунт');
        });
    }
    document.querySelector('.close-upload-modal')?.addEventListener('click', () => document.getElementById('uploadAvatarModal').style.display = 'none');

    // Добавление друга
    const addFriendBtn = document.getElementById('addFriendFromProfileBtn');
    if (addFriendBtn) {
        const newBtn = addFriendBtn.cloneNode(true);
        addFriendBtn.parentNode.replaceChild(newBtn, addFriendBtn);
        newBtn.addEventListener('click', () => {
            if (!currentUser) { alert('Войдите в аккаунт'); return; }
            document.getElementById('addFriendModal').style.display = 'flex';
            document.getElementById('friendNickname').value = '';
            document.getElementById('friendSearchResult').style.display = 'none';
        });
    }
    document.querySelector('.close-friend-modal')?.addEventListener('click', () => document.getElementById('addFriendModal').style.display = 'none');
    document.getElementById('searchFriendBtn')?.addEventListener('click', () => {
        const nick = document.getElementById('friendNickname').value.trim();
        const result = document.getElementById('friendSearchResult');
        if (!nick) { result.innerHTML = '<div class="alert alert-danger">Введите никнейм</div>'; result.style.display = 'block'; return; }
        const found = users.find(u => u.name.toLowerCase() === nick.toLowerCase() && !u.isBlocked && u.id !== currentUser?.id);
        if (!found) { result.innerHTML = '<div class="alert alert-danger">Пользователь не найден</div>'; result.style.display = 'block'; return; }
        if (currentUser.friends?.includes(found.id)) { result.innerHTML = '<div class="alert alert-warning">Уже в друзьях</div>'; result.style.display = 'block'; return; }
        result.innerHTML = `<div class="alert alert-info text-center"><img src="${found.avatar || DEFAULT_AVATAR}" style="width:60px;height:60px;border-radius:50%"><div><b>${escapeHtml(found.name)}</b></div><div>Сортирует: ${found.totalWeight} кг</div><button id="confirmAddFriendBtn" class="btn btn-success w-100 mt-2">Отправить заявку</button></div>`;
        result.style.display = 'block';
        document.getElementById('confirmAddFriendBtn')?.addEventListener('click', () => {
            sendFriendRequest(found.id);
            document.getElementById('addFriendModal').style.display = 'none';
        });
    });

    // Чат
    document.querySelector('.close-chat-modal')?.addEventListener('click', () => document.getElementById('chatModal').style.display = 'none');
    document.getElementById('sendMessageBtn')?.addEventListener('click', sendMessage);
    document.getElementById('chatMessageInput')?.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMessage(); });

    // Восстановление пароля
    document.getElementById('forgotPasswordBtn')?.addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('forgotPasswordModal').style.display = 'flex';
        document.getElementById('recoveryResult').style.display = 'none';
    });
    document.querySelector('.close-forgot-modal')?.addEventListener('click', () => document.getElementById('forgotPasswordModal').style.display = 'none');
    document.getElementById('recoverPasswordBtn')?.addEventListener('click', () => {
        const phone = document.getElementById('forgotPhone').value.trim();
        const result = document.getElementById('recoveryResult');
        if (!phone) { result.innerHTML = '<div class="alert alert-danger">Введите телефон</div>'; result.style.display = 'block'; return; }
        const user = users.find(u => u.phone === formatPhone(phone));
        result.innerHTML = user ? `<div class="alert alert-success">Ваш пароль: <b>${user.password}</b></div>` : '<div class="alert alert-danger">Пользователь не найден</div>';
        result.style.display = 'block';
    });

    // Закрытие модалок
    window.addEventListener('click', (e) => {
        if (e.target.classList?.contains('admin-modal')) e.target.style.display = 'none';
    });
});