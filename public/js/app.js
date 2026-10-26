// public/js/app.js — Enterprise RBAC Job Dashboard v2
let currentChartInstance = null;
let currentLocation = { lat: null, lng: null };
let currentCommentProjectId = null;
let idleTimer;

// ==================== UTIL ====================
function authHeaders() {
    const t = localStorage.getItem('token');
    return t ? { 'Authorization': 'Bearer ' + t, 'Content-Type': 'application/json' }
             : { 'Content-Type': 'application/json' };
}

async function api(url, opts = {}) {
    const res = await fetch(url, {
        ...opts,
        headers: { ...authHeaders(), ...(opts.headers || {}) }
    });
    if (res.status === 401) { handleLogout(); throw new Error('Sesi berakhir'); }
    return res;
}

function escapeHTML(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({
        '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[c]));
}

// ==================== TAB ====================
function switchTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
    const target = document.getElementById(`tab-${tabId}`);
    if (target) target.classList.remove('hidden');

    document.querySelectorAll('.tab-btn').forEach(b => { b.classList.remove('btn-active'); b.classList.add('btn-inactive'); });
    const active = document.getElementById(`btn-${tabId}`);
    if (active) { active.classList.add('btn-active'); active.classList.remove('btn-inactive'); }

    // Tutup sidebar di mobile
    if (window.innerWidth <= 768) document.getElementById('sidebar').classList.remove('open');

    if (tabId === 'rbac') loadRbacManagementData();
    if (tabId === 'leaderboard') loadLeaderboard();
    if (tabId === 'activity') loadActivity();
    if (tabId === 'settings') {
        const profInput = document.getElementById('prof-fullname');
        if (profInput) profInput.value = localStorage.getItem('userFullname') || '';
    }
}

function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('open');
}

// ==================== LOGIN ====================
async function handleLogin(e) {
    e.preventDefault();
    const usernameInp = document.getElementById('login-username').value;
    const passwordInp = document.getElementById('login-password').value;
    const errBox = document.getElementById('login-error');
    if (errBox) { errBox.classList.add('hidden'); errBox.innerText = ''; }

    try {
        const res = await fetch('/api/auth/login', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: usernameInp, password: passwordInp })
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.message || 'Gagal login');

        localStorage.setItem('isLoggedIn', 'true');
        localStorage.setItem('token', data.token);
        localStorage.setItem('userUsername', data.user.username);
        localStorage.setItem('userFullname', data.user.fullName);
        localStorage.setItem('userRoleId', data.user.roleId);
        localStorage.setItem('userRoleName', data.user.roleName);
        initializeSessionUI();
    } catch (err) {
        if (errBox) { errBox.classList.remove('hidden'); errBox.innerText = err.message; }
    }
}

function initializeSessionUI() {
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('main-application').classList.remove('hidden');

    const fullname = localStorage.getItem('userFullname') || 'User';
    const roleName = localStorage.getItem('userRoleName') || '';
    const roleId = localStorage.getItem('userRoleId');

    document.getElementById('user-display-name').innerText = fullname;
    document.getElementById('user-display-role').innerText = roleName;
    document.getElementById('avatar').innerText = fullname.trim().charAt(0).toUpperCase();

    // Sembunyikan menu RBAC + Activity untuk non-R01
    if (roleId !== 'R01') {
        document.getElementById('btn-rbac').classList.add('hidden');
        document.getElementById('btn-activity').classList.add('hidden');
        document.getElementById('btn-leaderboard').classList.add('hidden');
    }

    setupIdleTimer();
    applyTheme(localStorage.getItem('theme') || 'dark');

    loadRbacManagementData().then(() => loadDashboardData());
}

function handleLogout() {
    localStorage.clear();
    location.reload();
}

function setupIdleTimer() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
        if (localStorage.getItem('isLoggedIn') === 'true') {
            toast('Sesi berakhir karena tidak ada aktivitas', 'info');
            handleLogout();
        }
    }, 30 * 60 * 1000);
}
['mousemove','keydown','click','scroll'].forEach(ev =>
    document.addEventListener(ev, () => {
        if (localStorage.getItem('isLoggedIn') === 'true') setupIdleTimer();
    })
);

// ==================== DASHBOARD ====================
function getDateFilters() {
    return {
        search: (document.getElementById('search-laporan')?.value || '').trim(),
        from: document.getElementById('filter-from')?.value || '',
        to: document.getElementById('filter-to')?.value || '',
    };
}

async function loadDashboardData() {
    const loggedUser = localStorage.getItem('userUsername');
    const roleId = localStorage.getItem('userRoleId');
    const filterDropdown = document.getElementById('filter-username');
    const selectedUser = filterDropdown?.value || 'ALL';
    const filterCard = document.getElementById('filter-pegawai-container');
    const { search, from, to } = getDateFilters();

    const params = new URLSearchParams();
    if (roleId !== 'R01') {
        params.set('username', loggedUser);
        if (filterCard) filterCard.classList.add('hidden');
    } else if (selectedUser !== 'ALL') {
        params.set('username', selectedUser);
        if (filterCard) filterCard.classList.remove('hidden');
    }
    if (search) params.set('search', search);
    if (from) params.set('from', from);
    if (to) params.set('to', to);

    const tbody = document.getElementById('projects-table');
    if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="p-6 text-center text-gray-500">⏳ Memuat data…</td></tr>`;

    try {
        const r = await api('/api/projects?' + params.toString());
        const json = await r.json();
        const projectsArray = json.data || [];

        const goalsTable = document.getElementById('goals-table');
        const mainHeader = document.getElementById('main-berkala-header');
        const subHeader = document.getElementById('sub-berkala-header');
        if (goalsTable) goalsTable.innerHTML = '';
        if (tbody) tbody.innerHTML = '';

        let totalProgress = 0, selesaiCount = 0;

        if (projectsArray.length === 0) {
            if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="p-4 text-center text-gray-500">Belum ada data laporan.</td></tr>`;
            if (goalsTable) goalsTable.innerHTML = `<tr><td colspan="2" class="p-4 text-center text-gray-500">Belum ada catatan.</td></tr>`;
            if (subHeader) subHeader.innerHTML = `<th style="color:#475569;">Tidak ada kolom aktif</th>`;
            if (mainHeader) mainHeader.removeAttribute('colspan');
            ['stat-total','stat-selesai','stat-avg'].forEach(id => {
                const el = document.getElementById(id); if (el) el.innerText = id === 'stat-avg' ? '0%' : '0';
            });
            if (currentChartInstance) currentChartInstance.destroy();
            const ic = document.getElementById('insights');
            if (ic) ic.innerHTML = '<p class="text-sm text-gray-500 text-center py-4">Belum ada data untuk dianalisis.</p>';
            return;
        }

        // Kolom periode dinamis
        let activePeriods = [];
        projectsArray.forEach(project => {
            if (!project.startDate) return;
            const d = new Date(project.startDate);
            const year = d.getFullYear();
            const months = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"];
            const monthStr = months[d.getMonth()];
            let periodLabel;
            if (project.status === "Harian" || project.status === "Mingguan") {
                periodLabel = `Mgu ${Math.ceil(d.getDate()/7)} (${monthStr} ${year})`;
            } else if (project.status === "Bulanan") {
                periodLabel = `Bulan ${monthStr} (${year})`;
            } else {
                periodLabel = `Tahun ${year}`;
            }
            if (!activePeriods.includes(periodLabel)) activePeriods.push(periodLabel);
        });
        activePeriods.sort();

        if (mainHeader) { mainHeader.setAttribute('colspan', activePeriods.length); mainHeader.style.textAlign='center'; }
        if (subHeader) subHeader.innerHTML = activePeriods.map(p =>
            `<th style="text-align:center;font-size:11px;border-right:1px solid #334155;">${escapeHTML(p)}</th>`).join('');

        // Render baris
        projectsArray.forEach(project => {
            totalProgress += parseInt(project.progress, 10) || 0;
            if (parseInt(project.progress, 10) === 100) selesaiCount++;

            if (tbody) {
                const row = document.createElement('tr');
                row.className = 'table-row';
                const badgeClass = ({
                    Harian: 'badge badge-selesai',
                    Mingguan: 'badge badge-proses',
                    Bulanan: 'badge',
                    Tahunan: 'badge badge-baru'
                })[project.status] || 'badge badge-baru';

                const fileHTML = project.attachment
                    ? `<a href="${escapeHTML(project.attachment)}" target="_blank" class="link-btn">📁 Lihat</a>`
                    : `<span class="text-gray-600 text-xs">—</span>`;

                row.innerHTML = `
                    <td class="p-4 font-bold text-white">${escapeHTML(project.name)}</td>
                    <td class="p-4"><span class="${badgeClass}">${escapeHTML(project.status)}</span></td>
                    <td class="p-4">
                        <div class="progress-container">
                            <div class="progress-bg"><div class="progress-fill" style="width:${project.progress}%"></div></div>
                            <span class="text-white">${project.progress}%</span>
                        </div>
                    </td>
                    <td class="p-4 text-gray-400">${escapeHTML(project.startDate)}</td>
                    <td class="p-4 text-gray-400">${escapeHTML(project.endDate)}</td>
                    <td class="p-4">${fileHTML}</td>
                    <td class="p-4" style="white-space:nowrap;">
                        <button class="btn-aksi btn-edit" title="Edit" onclick='openEditProject(${project.id})'>✏️</button>
                        <button class="btn-aksi btn-comment" title="Komentar" onclick='openCommentModal(${project.id})'>💬</button>
                        <button class="btn-aksi btn-del" title="Hapus" onclick='deleteProject(${project.id})'>🗑️</button>
                    </td>
                `;
                tbody.appendChild(row);
            }

            if (goalsTable) {
                const goalRow = document.createElement('tr');
                goalRow.className = 'table-row';
                const goals = Array.isArray(project.goals) ? project.goals : [];
                const goalsListHTML = goals.map(g =>
                    `<li class="bullet-item"><span style="color:#818cf8;">•</span> ${escapeHTML(g)}</li>`).join('');

                const d = new Date(project.startDate);
                const months = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"];
                const monthStr = months[d.getMonth()];
                const year = d.getFullYear();
                let currentPeriod;
                if (project.status === "Harian" || project.status === "Mingguan") currentPeriod = `Mgu ${Math.ceil(d.getDate()/7)} (${monthStr} ${year})`;
                else if (project.status === "Bulanan") currentPeriod = `Bulan ${monthStr} (${year})`;
                else currentPeriod = `Tahun ${year}`;

                const cellsHTML = activePeriods.map(p => {
                    if (p === currentPeriod) return `<td class="p-4 align-top" style="border-right:1px solid #334155;background:rgba(99,102,241,.07);text-align:left;"><ul class="bullet-list">${goalsListHTML}</ul></td>`;
                    return `<td class="p-4 align-middle" style="text-align:center;border-right:1px solid #334155;color:#334155;font-weight:700;user-select:none;">–</td>`;
                }).join('');
                goalRow.innerHTML = `<td class="p-4 font-bold align-top" style="border-right:1px solid #334155;background:rgba(15,23,42,.5);color:#818cf8;">${escapeHTML(project.name)}</td>${cellsHTML}`;
                goalsTable.appendChild(goalRow);
            }
        });

        // Stats
        const avgProgress = Math.round(totalProgress / projectsArray.length);
        document.getElementById('stat-total').innerText = projectsArray.length;
        document.getElementById('stat-selesai').innerText = selesaiCount;
        document.getElementById('stat-avg').innerText = avgProgress + '%';

        // Chart
        const chartContainer = document.getElementById('myChart');
        if (chartContainer) {
            if (currentChartInstance) currentChartInstance.destroy();
            currentChartInstance = new Chart(chartContainer.getContext('2d'), {
                type: 'bar',
                data: {
                    labels: projectsArray.map(p => p.name),
                    datasets: [{
                        label: 'Progress (%)',
                        data: projectsArray.map(p => parseInt(p.progress, 10) || 0),
                        backgroundColor: 'rgba(99,102,241,.6)',
                        borderColor: '#6366f1',
                        borderWidth: 1
                    }]
                }
            });
        }

        // Insights
        const ic = document.getElementById('insights');
        if (ic) {
            let baik = "Manajemen awal bagus, berkas diselesaikan tepat waktu.";
            let perbaikan = "Percepat target kerja berkala agar tidak menumpuk.";
            let kembang = "Tingkatkan tantangan mingguan untuk akselerasi performa.";
            if (avgProgress > 75) baik = "Luar biasa! Efisiensi pengerjaan sangat mengagumkan!";
            if (selesaiCount === 0) perbaikan = "Belum ada pekerjaan rampung 100%.";
            ic.innerHTML = `
                <div class="insight-box bg-green-box"><span class="text-xs font-bold text-green-400">SUDAH BAIK</span><p class="text-sm text-gray-300 mt-2">${baik}</p></div>
                <div class="insight-box bg-yellow-box"><span class="text-xs font-bold text-yellow-400">PERLU DIPERBAIKI</span><p class="text-sm text-gray-300 mt-2">${perbaikan}</p></div>
                <div class="insight-box bg-blue-box"><span class="text-xs font-bold text-indigo-400">PERLU DIKEMBANGKAN</span><p class="text-sm text-gray-300 mt-2">${kembang}</p></div>
            `;
        }
    } catch (err) {
        if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="p-6 text-center" style="color:#f87171;">Gagal memuat: ${escapeHTML(err.message)}</td></tr>`;
    }
}

// ==================== RBAC ====================
function loadRbacManagementData() {
    const pRoles = api('/api/roles').then(r => r.json()).then(roles => {
        const sel = document.getElementById('user-role-select');
        if (sel) sel.innerHTML = roles.map(r => `<option value="${r.id}">${escapeHTML(r.name)}</option>`).join('');
        const rt = document.getElementById('roles-rbac-table');
        if (rt) rt.innerHTML = roles.map(r => `
            <tr class="table-row">
                <td class="p-4 font-bold text-white">${escapeHTML(r.name)}</td>
                <td class="p-4" style="display:flex;gap:.5rem;">
                    <button onclick="editRole('${r.id}','${escapeHTML(r.name)}')" style="background:#eab308;border:none;padding:4px 10px;border-radius:4px;color:white;font-size:11px;cursor:pointer;">Edit</button>
                    <button onclick="deleteRole('${r.id}')" style="background:#ef4444;border:none;padding:4px 10px;border-radius:4px;color:white;font-size:11px;cursor:pointer;">Hapus</button>
                </td>
            </tr>`).join('');
    }).catch(() => {});

    const pUsers = api('/api/users').then(r => r.json()).then(users => {
        const tb = document.getElementById('users-rbac-table');
        if (tb) tb.innerHTML = users.map(u => `
            <tr class="table-row">
                <td class="p-4 font-bold text-white">${escapeHTML(u.fullName)}</td>
                <td class="p-4 text-gray-400">${escapeHTML(u.username)}</td>
                <td class="p-4 text-indigo-400">${escapeHTML(u.roleName || '')}</td>
                <td class="p-4"><button onclick="deletePegawai('${u.username}')" style="background:#ef4444;border:none;padding:4px 10px;border-radius:4px;color:white;font-size:11px;cursor:pointer;">Hapus</button></td>
            </tr>`).join('');

        const fd = document.getElementById('filter-username');
        if (fd) fd.innerHTML = `<option value="ALL">-- Seluruh Pegawai (Kumulatif) --</option>` +
            users.map(u => `<option value="${u.username}">${escapeHTML(u.fullName)} (${escapeHTML(u.roleName || '')})</option>`).join('');
    }).catch(() => {});

    return Promise.all([pRoles, pUsers]);
}

function handleRoleSubmit(e) {
    e.preventDefault();
    const name = document.getElementById('role-name').value.trim();
    const editId = document.getElementById('edit-role-id').value;
    if (!name) return toast('Nama jabatan wajib', 'error');

    if (editId) {
        api(`/api/roles/${editId}`, { method:'PUT', body: JSON.stringify({ name }) })
            .then(() => { toast('Jabatan diperbarui', 'success'); resetRoleForm(); loadRbacManagementData(); });
    } else {
        api('/api/roles', { method:'POST', body: JSON.stringify({ name }) })
            .then(() => { toast('Jabatan ditambahkan', 'success'); document.getElementById('role-name').value=''; loadRbacManagementData(); });
    }
}

function editRole(id, name) {
    document.getElementById('edit-role-id').value = id;
    document.getElementById('role-name').value = name;
    document.getElementById('role-form-title').innerText = '📝 Edit Jabatan';
    document.getElementById('btn-role-submit').innerText = 'Perbarui';
    document.getElementById('btn-role-cancel').classList.remove('hidden');
}

function resetRoleForm() {
    document.getElementById('edit-role-id').value = '';
    document.getElementById('role-name').value = '';
    document.getElementById('role-form-title').innerText = '➕ Tambah Jabatan';
    document.getElementById('btn-role-submit').innerText = 'Simpan';
    document.getElementById('btn-role-cancel').classList.add('hidden');
}

function deleteRole(id) {
    if (!confirm('Hapus jabatan ini?')) return;
    api(`/api/roles/${id}`, { method:'DELETE' })
        .then(async res => {
            if (!res.ok) { const e = await res.json(); throw new Error(e.message); }
            toast('Jabatan dihapus', 'success'); loadRbacManagementData();
        })
        .catch(err => toast(err.message, 'error'));
}

function handleUserSubmit(e) {
    e.preventDefault();
    const fullName = document.getElementById('user-fullname').value;
    const username = document.getElementById('user-username').value;
    const password = document.getElementById('user-password').value;
    const roleId = document.getElementById('user-role-select').value;

    api('/api/users', {
        method: 'POST',
        body: JSON.stringify({ username, password, fullName, roleId })
    }).then(async res => {
        const j = await res.json();
        if (!res.ok || !j.success) throw new Error(j.message);
        toast('Pegawai terdaftar', 'success');
        document.getElementById('user-fullname').value = '';
        document.getElementById('user-username').value = '';
        document.getElementById('user-password').value = '';
        loadRbacManagementData();
    }).catch(err => toast(err.message, 'error'));
}

function deletePegawai(username) {
    if (!confirm(`Hapus akun ${username}?`)) return;
    api(`/api/users/${username}`, { method:'DELETE' })
        .then(() => { toast('Pegawai dihapus', 'success'); loadRbacManagementData(); })
        .catch(err => toast(err.message, 'error'));
}

// ==================== PROJECT CRUD ====================

// FUNGSI BARU: Kompres Gambar sebelum Upload
function compressImage(file, maxWidth, maxHeight, quality, callback) {
    const reader = new FileReader();
    reader.onload = function(e) {
        const img = new Image();
        img.onload = function() {
            let width = img.width;
            let height = img.height;

            // Hitung rasio agar tidak gepeng
            if (width > height) {
                if (width > maxWidth) {
                    height = Math.round((height * maxWidth) / width);
                    width = maxWidth;
                }
            } else {
                if (height > maxHeight) {
                    width = Math.round((width * maxHeight) / height);
                    height = maxHeight;
                }
            }

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);

            // Hasil kompresi (JPEG)
            const compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
            callback(compressedDataUrl);
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

function handleProjectSubmit(e) {
    e.preventDefault();
    const editId = document.getElementById('edit-project-id').value;
    const name = document.getElementById('inp-name').value.trim();
    const progress = parseInt(document.getElementById('inp-progress').value, 10);
    const status = document.getElementById('inp-status').value;
    const startDate = document.getElementById('inp-start').value;
    const endDate = document.getElementById('inp-end').value;
    const goals = document.getElementById('inp-goals').value.split(',').map(s => s.trim()).filter(Boolean);

    if (!name) return toast('Nama wajib diisi', 'error');
    if (isNaN(progress) || progress < 0 || progress > 100) return toast('Progress harus 0–100', 'error');
    if (new Date(endDate) < new Date(startDate)) return toast('Tanggal selesai tidak boleh sebelum mulai', 'error');
    if (!goals.length) return toast('Minimal 1 catatan pekerjaan', 'error');

    // Ambil koordinat GPS saat ini (jika ada)
    const lat = window.currentLocation ? window.currentLocation.lat : null;
    const lng = window.currentLocation ? window.currentLocation.lng : null;

    const payload = { 
        name, status, progress, startDate, endDate, goals,
        latitude: lat, 
        longitude: lng
    };

    const send = (extra = {}) => {
        const url = editId ? `/api/projects/${editId}` : '/api/projects';
        const method = editId ? 'PUT' : 'POST';
        
        toast('Menyimpan data...', 'info');

        api(url, { method, body: JSON.stringify({ ...payload, ...extra }) })
            .then(async res => {
                const j = await res.json();
                if (!res.ok || j.success === false) {
                    throw new Error(j.message || j.error || 'Gagal menyimpan data');
                }
                toast(editId ? 'Pekerjaan diperbarui' : 'Pekerjaan ditambahkan', 'success');
                resetProjectForm();
                loadDashboardData();
                switchTab('dashboard');
            }).catch(err => {
                console.error('Save Error:', err);
                toast('Error: ' + err.message, 'error');
            });
    };

    // Jika mode edit ATAU ada file baru yang dipilih
    if (window.currentSelectedFile && !editId) {
        if (window.currentSelectedFile.size > 8 * 1024 * 1024) return toast('File maksimal 8MB', 'error');
        
        // PROSES KOMPRESI GAMBAR
        toast('Mengompres gambar...', 'info');
        compressImage(window.currentSelectedFile, 1280, 1280, 0.7, function(compressedBase64) {
            send({ fileData: compressedBase64, fileName: window.currentSelectedFile.name });
        });
    } else {
        send();
    }
}

// Helper untuk sinkronisasi input file ke form
let currentSelectedFile = null;

function handleFileSelect(inputElement) {
    if (inputElement.files && inputElement.files[0]) {
        currentSelectedFile = inputElement.files[0];
        document.getElementById('file-name-display').innerText = `📎 ${currentSelectedFile.name} (${(currentSelectedFile.size / 1024).toFixed(1)} KB)`;
    }
}

// Reset saat form di-reset
function resetProjectForm() {
    document.getElementById('edit-project-id').value = '';
    document.querySelector('#tab-input form').reset();
    document.getElementById('btn-project-submit').innerText = 'Simpan Pekerjaan';
    document.getElementById('btn-project-cancel').classList.add('hidden');
    
    // Reset file
    currentSelectedFile = null;
    const display = document.getElementById('file-name-display');
    if (display) display.innerText = 'Belum ada file yang dipilih.';
}

async function openEditProject(id) {
    try {
        const r = await api(`/api/projects/${id}`);
        const p = await r.json();
        if (!r.ok) throw new Error(p.message);
        document.getElementById('edit-project-id').value = p.id;
        document.getElementById('inp-name').value = p.name;
        document.getElementById('inp-progress').value = p.progress;
        document.getElementById('inp-status').value = p.status;
        document.getElementById('inp-start').value = p.startDate;
        document.getElementById('inp-end').value = p.endDate;
        document.getElementById('inp-goals').value = (p.goals || []).join(', ');
        document.getElementById('btn-project-submit').innerText = 'Update Pekerjaan';
        document.getElementById('btn-project-cancel').classList.remove('hidden');
        switchTab('input');
    } catch (err) { toast(err.message, 'error'); }
}

function resetProjectForm() {
    document.getElementById('edit-project-id').value = '';
    document.querySelector('#tab-input form').reset();
    document.getElementById('btn-project-submit').innerText = 'Simpan Pekerjaan';
    document.getElementById('btn-project-cancel').classList.add('hidden');
}

function deleteProject(id) {
    if (!confirm('Hapus pekerjaan ini?')) return;
    api(`/api/projects/${id}`, { method:'DELETE' })
        .then(() => { toast('Pekerjaan dihapus', 'success'); loadDashboardData(); })
        .catch(err => toast(err.message, 'error'));
}

// ==================== KOMENTAR ====================
async function openCommentModal(projectId) {
    currentCommentProjectId = projectId;
    document.getElementById('comment-modal').classList.remove('hidden');
    await loadComments();
}

function closeCommentModal() {
    currentCommentProjectId = null;
    document.getElementById('comment-modal').classList.add('hidden');
}

async function loadComments() {
    const list = document.getElementById('comment-list');
    list.innerHTML = '<p style="color:#94a3b8;font-size:.85rem;">Memuat…</p>';
    try {
        const r = await api(`/api/projects/${currentCommentProjectId}/comments`);
        const comments = await r.json();
        if (!comments.length) { list.innerHTML = '<p style="color:#64748b;font-size:.85rem;">Belum ada komentar.</p>'; return; }
        list.innerHTML = comments.map(c => `
            <div style="padding:.5rem .75rem;background:#0f172a;border-radius:.5rem;margin-bottom:.5rem;">
                <div style="font-size:.75rem;color:#818cf8;font-weight:600;">${escapeHTML(c.authorName || c.author)} <span style="color:#475569;font-weight:400;">• ${escapeHTML(c.createdAt)}</span></div>
                <div style="color:#e2e8f0;font-size:.875rem;margin-top:.25rem;">${escapeHTML(c.message)}</div>
            </div>
        `).join('');
    } catch (err) { list.innerHTML = `<p style="color:#f87171;">${escapeHTML(err.message)}</p>`; }
}

async function submitComment(e) {
    e.preventDefault();
    const inp = document.getElementById('comment-input');
    const msg = inp.value.trim();
    if (!msg) return;
    try {
        await api(`/api/projects/${currentCommentProjectId}/comments`, {
            method:'POST', body: JSON.stringify({ message: msg })
        });
        inp.value = '';
        loadComments();
    } catch (err) { toast(err.message, 'error'); }
}

// ==================== LEADERBOARD ====================
async function loadLeaderboard() {
    const tb = document.getElementById('leaderboard-table');
    tb.innerHTML = '<tr><td colspan="6" class="p-4 text-center text-gray-500">Memuat…</td></tr>';
    try {
        const r = await api('/api/stats/leaderboard');
        const rows = await r.json();
        if (!r.ok) throw new Error(rows.message);
        tb.innerHTML = rows.map((u, i) => `
            <tr class="table-row">
                <td class="p-4">${i + 1}${i === 0 ? ' 🥇' : i === 1 ? ' 🥈' : i === 2 ? ' 🥉' : ''}</td>
                <td class="p-4 font-bold text-white">${escapeHTML(u.fullName)}</td>
                <td class="p-4 text-indigo-400">${escapeHTML(u.roleName || '')}</td>
                <td class="p-4">${u.total}</td>
                <td class="p-4 text-green-400">${u.selesai}</td>
                <td class="p-4 text-yellow-400 font-bold">${u.avgProgress}%</td>
            </tr>
        `).join('');
    } catch (err) { tb.innerHTML = `<tr><td colspan="6" class="p-4 text-center" style="color:#f87171;">${escapeHTML(err.message)}</td></tr>`; }
}

// ==================== ACTIVITY LOG ====================
async function loadActivity() {
    const tb = document.getElementById('activity-table');
    tb.innerHTML = '<tr><td colspan="4" class="p-4 text-center text-gray-500">Memuat…</td></tr>';
    try {
        const r = await api('/api/activity');
        const rows = await r.json();
        if (!r.ok) throw new Error(rows.message);
        tb.innerHTML = rows.map(a => `
            <tr class="table-row">
                <td class="p-4 text-gray-400 text-xs">${escapeHTML(a.createdAt)}</td>
                <td class="p-4 text-indigo-400">${escapeHTML(a.actor || '-')}</td>
                <td class="p-4 font-bold text-white">${escapeHTML(a.action)}</td>
                <td class="p-4 text-gray-400">${escapeHTML(a.detail || '')}</td>
            </tr>
        `).join('') || '<tr><td colspan="4" class="p-4 text-center text-gray-500">Belum ada aktivitas.</td></tr>';
    } catch (err) { tb.innerHTML = `<tr><td colspan="4" class="p-4 text-center" style="color:#f87171;">${escapeHTML(err.message)}</td></tr>`; }
}

// ==================== EXPORT CSV ====================
async function exportCSV() {
    const btn = event?.target;
    if (btn) { btn.innerText = '⏳ Menyiapkan...'; btn.disabled = true; }

    try {
        // Ambil ulang data dari database agar akurat (bukan dari HTML)
        const r = await api('/api/projects?limit=9999');
        const json = await r.json();
        const data = json.data || [];

        if (data.length === 0) {
            toast('Belum ada data untuk di-export', 'info');
            return;
        }

        // Buat Header
        const rows = [['Nama Pekerjaan', 'Status', 'Progress (%)', 'Tanggal Mulai', 'Tanggal Selesai', 'Catatan']];
        
        // Isi Data
        data.forEach(p => {
            const goalsText = Array.isArray(p.goals) ? p.goals.join(' | ') : '';
            rows.push([
                p.name,
                p.status,
                p.progress,
                p.startDate,
                p.endDate,
                goalsText
            ]);
        });

        // Konversi ke format CSV (escape tanda kutip)
        const csvContent = rows.map(row => 
            row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')
        ).join('\n');

        // Download
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `laporan-pekerjaan-${new Date().toISOString().slice(0,10)}.csv`;
        a.click();
        toast('Export CSV berhasil', 'success');
    } catch (err) {
        toast('Gagal export CSV: ' + err.message, 'error');
    } finally {
        if (btn) { btn.innerText = '⬇️ Export CSV'; btn.disabled = false; }
    }
}

// ==================== TEMA ====================
function applyTheme(theme) {
    document.body.classList.toggle('light-theme', theme === 'light');
    localStorage.setItem('theme', theme);
}
async function setTheme(theme) {
    applyTheme(theme);
    try { await api('/api/settings', { method:'PUT', body: JSON.stringify({ theme }) }); } catch {}
    toast(`Tema ${theme} aktif`, 'success');
}

// ==================== GANTI PASSWORD ====================
async function handleChangePassword(e) {
    e.preventDefault();
    const oldPassword = document.getElementById('cp-old').value;
    const newPassword = document.getElementById('cp-new').value;
    try {
        const r = await api('/api/auth/change-password', {
            method: 'POST', body: JSON.stringify({ oldPassword, newPassword })
        });
        const j = await r.json();
        if (!r.ok || !j.success) throw new Error(j.message);
        toast('Password berhasil diganti', 'success');
        document.getElementById('cp-old').value = '';
        document.getElementById('cp-new').value = '';
    } catch (err) { toast(err.message, 'error'); }
}

// ==================== FUNGSI KAMERA (WEBCAM) ====================
let cameraStream = null;

async function openCameraModal() {
    const modal = document.getElementById('camera-modal');
    const video = document.getElementById('camera-stream');
    const gpsInfo = document.getElementById('gps-info');
    
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        toast('Browser Anda tidak mendukung fitur kamera.', 'error');
        document.getElementById('input-camera').click();
        return;
    }

    modal.classList.remove('hidden');
    gpsInfo.innerHTML = '📍 Mendeteksi lokasi GPS...';
    currentLocation = { lat: null, lng: null }; // Reset

    // 1. Ambil GPS (jika diizinkan)
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (position) => {
                currentLocation.lat = position.coords.latitude.toFixed(6);
                currentLocation.lng = position.coords.longitude.toFixed(6);
                gpsInfo.innerHTML = `📍 Lokasi terdeteksi: ${currentLocation.lat}, ${currentLocation.lng}`;
            },
            (error) => {
                gpsInfo.innerHTML = `⚠️ Gagal mendapat lokasi (Izin ditolak).`;
            },
            { enableHighAccuracy: true, timeout: 5000 }
        );
    }

    // 2. Nyalakan Kamera
    try {
        cameraStream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: 'environment' } 
        });
        video.srcObject = cameraStream;
    } catch (err) {
        console.error(err);
        toast('Gagal mengakses kamera. Pastikan izin kamera diizinkan.', 'error');
        modal.classList.add('hidden');
    }
}

function closeCameraModal() {
    const modal = document.getElementById('camera-modal');
    const video = document.getElementById('camera-stream');
    
    // Matikan kamera (wajib, agar lampu webcam mati)
    if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
        cameraStream = null;
    }
    video.srcObject = null;
    modal.classList.add('hidden');
}

function takePhoto() {
    const video = document.getElementById('camera-stream');
    const canvas = document.getElementById('camera-canvas');
    const context = canvas.getContext('2d');

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    
    // 1. Gambar frame video
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    // 2. Tambahkan Watermark (Waktu & Lokasi)
    const now = new Date();
    const timeStr = now.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
    let locStr = (currentLocation.lat && currentLocation.lng) 
        ? `Lat: ${currentLocation.lat}, Lng: ${currentLocation.lng}` 
        : 'Lokasi tidak tersedia';

    // Styling teks watermark
    context.font = 'bold 24px Arial';
    context.fillStyle = 'white';
    context.shadowColor = 'black';
    context.shadowBlur = 4;
    
    // Posisi teks (kiri bawah)
    const padding = 20;
    context.fillText(`📅 ${timeStr}`, padding, canvas.height - 60);
    context.fillText(`📍 ${locStr}`, padding, canvas.height - 25);

    // Konversi ke Base64
    const imageDataUrl = canvas.toDataURL('image/jpeg', 0.85);

    fetch(imageDataUrl)
        .then(res => res.blob())
        .then(blob => {
            const file = new File([blob], `kamera-${Date.now()}.jpg`, { type: 'image/jpeg' });
            currentSelectedFile = file;
            document.getElementById('file-name-display').innerText = `📸 ${file.name} (${(file.size / 1024).toFixed(1)} KB) | 📍 GPS Tertanam`;
            closeCameraModal();
            toast('Foto berhasil diambil beserta lokasi & waktu!', 'success');
        });
}

// Fitur Global Search
let searchDebounce;
function handleGlobalSearch(query) {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
        // Pindah ke tab laporan
        switchTab('laporan');
        // Isi otomatis input search di laporan
        const inputLaporan = document.getElementById('search-laporan');
        if (inputLaporan) {
            inputLaporan.value = query;
            loadDashboardData(); // Picu render ulang
        }
    }, 400); // Tunggu 400ms setelah user berhenti ngetik
}

async function handleUpdateProfile(e) {
    e.preventDefault();
    const fullName = document.getElementById('prof-fullname').value;
    
    try {
        const r = await api('/api/auth/profile', {
            method: 'PUT',
            body: JSON.stringify({ fullName })
        });
        const data = await r.json();
        
        if (!r.ok || !data.success) throw new Error(data.message);
        
        // Update localStorage & Tampilan
        localStorage.setItem('userFullname', data.user.fullName);
        document.getElementById('user-display-name').innerText = data.user.fullName;
        document.getElementById('avatar').innerText = data.user.fullName.trim().charAt(0).toUpperCase();
        
        toast('Profil berhasil diperbarui', 'success');
    } catch (err) {
        toast(err.message, 'error');
    }
}

// ==================== INIT ====================
document.addEventListener('DOMContentLoaded', () => {
    if (localStorage.getItem('isLoggedIn') === 'true') initializeSessionUI();

    // TAMBAHKAN INI: Deteksi perubahan pada input file secara global
    document.body.addEventListener('change', function(e) {
        if (e.target && e.target.type === 'file') {
            if (e.target.files && e.target.files[0]) {
                // Paksa simpan ke variabel global
                window.currentSelectedFile = e.target.files[0];
                
                // Tampilkan nama file di layar
                const display = document.getElementById('file-name-display');
                if (display) {
                    display.innerText = `📎 ${window.currentSelectedFile.name} (${(window.currentSelectedFile.size / 1024).toFixed(1)} KB)`;
                }
            }
        }
    });
});