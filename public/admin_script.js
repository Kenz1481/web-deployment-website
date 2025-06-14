document.addEventListener('DOMContentLoaded', () => {
    const adminContent = document.getElementById('admin-content');
    let authToken = localStorage.getItem('authToken');

    function showMessage(container, message, type = 'success') {
        const messageDivId = 'admin-message-area';
        let messageArea = document.getElementById(messageDivId);
        if (!messageArea) {
            messageArea = document.createElement('div');
            messageArea.id = messageDivId;
            container.prepend(messageArea); // Prepend to the specific container
        }
        
        messageArea.textContent = message;
        messageArea.className = `message-${type}`; // Uses existing CSS classes
        messageArea.style.display = 'block';
        setTimeout(() => {
            if(messageArea) messageArea.style.display = 'none';
        }, 5000);
    }


    function renderLoginForm() {
        adminContent.innerHTML = `
            <div class="form-section admin-login-prompt">
                <h2><i class="fas fa-sign-in-alt"></i> Admin Login</h2>
                <div id="login-message-area"></div>
                <form id="login-form">
                    <div>
                        <label for="username">Username:</label>
                        <input type="text" id="username" name="username" required>
                    </div>
                    <div>
                        <label for="password">Password:</label>
                        <input type="password" id="password" name="password" required>
                    </div>
                    <button type="submit" class="btn btn-primary"><i class="fas fa-sign-in-alt"></i> Login</button>
                </form>
            </div>
        `;

        const loginForm = document.getElementById('login-form');
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = loginForm.username.value;
            const password = loginForm.password.value;

            try {
                const response = await fetch('/api/auth/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password })
                });
                const data = await response.json();
                if (!response.ok) {
                    throw new Error(data.message || 'Login failed');
                }
                authToken = data.token;
                localStorage.setItem('authToken', authToken);
                showMessage(document.getElementById('login-message-area'), 'Login successful! Loading dashboard...', 'success');
                setTimeout(renderAdminDashboard, 1000); // Give time for message to be seen
            } catch (error) {
                console.error('Login error:', error);
                showMessage(document.getElementById('login-message-area'), error.message, 'error');
            }
        });
    }

    async function renderAdminDashboard() {
        if (!authToken) {
            renderLoginForm();
            return;
        }
        adminContent.innerHTML = `
            <h2><i class="fas fa-cogs"></i> Kelola Proyek</h2>
            <button id="logout-btn" class="btn btn-danger" style="margin-bottom:20px;"><i class="fas fa-sign-out-alt"></i> Logout</button>
            <div id="admin-message-area-dashboard" style="margin-bottom: 15px;"></div>
            
            <div class="form-section">
                <h3><i class="fas fa-plus-circle"></i> Tambah Proyek Baru</h3>
                <form id="add-project-form" enctype="multipart/form-data">
                    <div>
                        <label for="projectName">Nama Proyek:</label>
                        <input type="text" id="projectName" name="projectName" required>
                    </div>
                    <div>
                        <label for="description">Deskripsi:</label>
                        <textarea id="description" name="description"></textarea>
                    </div>
                    <div>
                        <label for="subdomain">Subdomain (untuk Vercel, unik):</label>
                        <input type="text" id="subdomain" name="subdomain">
                        <small>Contoh: my-cool-project (hasilnya: my-cool-project.vercel.app)</small>
                    </div>
                    <div>
                        <label for="repoUrl">URL Git Repository (Opsional):</label>
                        <input type="text" id="repoUrl" name="repoUrl" placeholder="https://github.com/user/repo.git">
                    </div>
                    <div>
                        <label for="projectFile">atau Upload File ZIP Proyek (Opsional):</label>
                        <input type="file" id="projectFile" name="projectFile" accept=".zip">
                    </div>
                    <button type="submit" class="btn btn-primary"><i class="fas fa-plus"></i> Tambah Proyek</button>
                </form>
            </div>

            <div class="project-list-section">
                <h3><i class="fas fa-tasks"></i> Daftar Proyek</h3>
                <div id="admin-project-list"><p>Memuat proyek...</p></div>
            </div>
        `;
        
        document.getElementById('logout-btn').addEventListener('click', () => {
            localStorage.removeItem('authToken');
            authToken = null;
            showMessage(adminContent.querySelector('#admin-message-area-dashboard'), 'Logout successful.', 'success');
            renderLoginForm();
        });

        const addProjectForm = document.getElementById('add-project-form');
        addProjectForm.addEventListener('submit', handleAddProject);
        
        fetchAdminProjects();
    }

    async function handleAddProject(e) {
        e.preventDefault();
        const formData = new FormData(e.target);
        const dashboardMessageContainer = adminContent.querySelector('#admin-message-area-dashboard');

        // Basic validation: either repoUrl or projectFile should be provided (or neither if just creating an entry)
        // const repoUrl = formData.get('repoUrl');
        // const projectFile = formData.get('projectFile');
        // if (!repoUrl && (!projectFile || projectFile.size === 0)) {
        //     showMessage(dashboardMessageContainer, 'Harap sediakan URL Repository atau upload file ZIP.', 'error');
        //     return;
        // }


        try {
            const response = await fetch('/api/admin/projects', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${authToken}`
                    // 'Content-Type' will be set automatically by browser for FormData
                },
                body: formData
            });
            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.message || 'Gagal menambah proyek');
            }
            showMessage(dashboardMessageContainer, `Proyek "${data.projectName}" berhasil ditambahkan!`, 'success');
            e.target.reset();
            fetchAdminProjects(); // Refresh list
        } catch (error) {
            console.error('Error adding project:', error);
            showMessage(dashboardMessageContainer, `Error: ${error.message}`, 'error');
        }
    }


    async function fetchAdminProjects() {
        const projectListDiv = document.getElementById('admin-project-list');
        if (!projectListDiv) return;

        try {
            const response = await fetch('/api/admin/projects', {
                headers: { 'Authorization': `Bearer ${authToken}` }
            });
            if (response.status === 401 || response.status === 403) {
                localStorage.removeItem('authToken');
                authToken = null;
                renderLoginForm();
                showMessage(adminContent.querySelector('.admin-login-prompt') || adminContent, 'Sesi berakhir atau tidak valid. Silakan login kembali.', 'error');
                return;
            }
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
            }
            const projects = await response.json();
            renderAdminProjectTable(projects);
        } catch (error) {
            console.error('Error fetching admin projects:', error);
            projectListDiv.innerHTML = `<p class="message-error">Gagal memuat proyek: ${error.message}</p>`;
        }
    }

    function renderAdminProjectTable(projects) {
        const projectListDiv = document.getElementById('admin-project-list');
        if (projects.length === 0) {
            projectListDiv.innerHTML = '<p>Belum ada proyek.</p>';
            return;
        }

        const table = document.createElement('table');
        table.className = 'admin-project-table';
        table.innerHTML = `
            <thead>
                <tr>
                    <th>Nama Proyek</th>
                    <th>Subdomain</th>
                    <th>Status</th>
                    <th>URL Deploy</th>
                    <th>Diperbarui</th>
                    <th>Aksi</th>
                </tr>
            </thead>
            <tbody>
            </tbody>
        `;
        const tbody = table.querySelector('tbody');
        projects.forEach(project => {
            const row = tbody.insertRow();
            row.innerHTML = `
                <td>${project.projectName}</td>
                <td>${project.subdomain || '-'}</td>
                <td class="status status-${project.status.toLowerCase().replace(/_/g, '-')}">${project.status}</td>
                <td>${project.deploymentUrl ? `<a href="${project.deploymentUrl}" target="_blank">${project.deploymentUrl}</a>` : 'Belum deploy'}</td>
                <td>${new Date(project.updatedAt).toLocaleString()}</td>
                <td>
                    <button class="btn btn-sm btn-secondary view-details-btn" data-id="${project._id}"><i class="fas fa-eye"></i> Detail</button>
                    <button class="btn btn-sm btn-danger delete-btn" data-id="${project._id}"><i class="fas fa-trash"></i> Hapus</button>
                    <!-- Add edit button later if needed -->
                </td>
            `;
            // Add event listeners for buttons
             row.querySelector('.delete-btn').addEventListener('click', (e) => handleDeleteProject(e.target.closest('button').dataset.id, project.projectName));
             row.querySelector('.view-details-btn').addEventListener('click', (e) => showProjectDetailsModal(e.target.closest('button').dataset.id));
        });
        projectListDiv.innerHTML = ''; // Clear loading
        projectListDiv.appendChild(table);
    }
    
    async function showProjectDetailsModal(projectId) {
        try {
            const response = await fetch(`/api/admin/projects/${projectId}`, {
                headers: { 'Authorization': `Bearer ${authToken}` }
            });
            if (!response.ok) throw new Error('Failed to fetch project details.');
            const project = await response.json();

            const modalId = 'project-details-modal';
            let modal = document.getElementById(modalId);
            if (modal) modal.remove(); // Remove existing modal if any

            modal = document.createElement('div');
            modal.id = modalId;
            modal.style.cssText = `
                position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                background-color: rgba(0,0,0,0.7); display: flex;
                align-items: center; justify-content: center; z-index: 1000; padding: 20px;
            `;
            
            const logsHtml = project.logs && project.logs.length > 0 ?
                project.logs.map(log => `<li><small>${new Date(log.timestamp).toLocaleString()}</small> [${log.type || 'info'}] ${log.message}</li>`).join('') :
                '<li>Tidak ada log.</li>';

            modal.innerHTML = `
                <div style="background: var(--card-background); padding: 25px; border-radius: 8px; width: 90%; max-width: 700px; max-height: 90vh; overflow-y: auto; color: var(--text-color);">
                    <button id="close-modal-btn" style="float: right; background: none; border: none; color: var(--accent-color); font-size: 1.5rem;">×</button>
                    <h3>Detail Proyek: ${project.projectName}</h3>
                    <p><strong>ID:</strong> ${project._id}</p>
                    <p><strong>Deskripsi:</strong> ${project.description || '-'}</p>
                    <p><strong>Subdomain:</strong> ${project.subdomain || '-'}</p>
                    <p><strong>Repo URL:</strong> ${project.repoUrl || '-'}</p>
                    <p><strong>File Path (internal):</strong> ${project.filePath || '-'}</p>
                    <p><strong>Status:</strong> <span class="status status-${project.status.toLowerCase().replace(/_/g, '-')}">${project.status}</span></p>
                    <p><strong>Deployment URL:</strong> ${project.deploymentUrl ? `<a href="${project.deploymentUrl}" target="_blank">${project.deploymentUrl}</a>` : '-'}</p>
                    <p><strong>Vercel Project ID:</strong> ${project.vercelProjectId || '-'}</p>
                    <p><strong>GitHub Repo Name:</strong> ${project.githubRepoName || '-'}</p>
                    <p><strong>Dibuat:</strong> ${new Date(project.createdAt).toLocaleString()}</p>
                    <p><strong>Diperbarui:</strong> ${new Date(project.updatedAt).toLocaleString()}</p>
                    <h4>Logs:</h4>
                    <ul style="list-style: none; padding-left: 0; font-size: 0.9em; max-height: 200px; overflow-y: auto; background: #111; padding: 10px; border-radius: 5px;">${logsHtml}</ul>
                    
                    <h4>Reviews:</h4>
                    ${project.reviews && project.reviews.length > 0 ? 
                        project.reviews.map(r => `<div class="review-item"><p><strong>${r.reviewerName}</strong> (${r.rating} stars): ${r.comment}</p></div>`).join('') : 
                        '<p>Belum ada review.</p>'
                    }
                </div>
            `;
            document.body.appendChild(modal);
            document.getElementById('close-modal-btn').addEventListener('click', () => modal.remove());
            modal.addEventListener('click', (e) => { // Close on overlay click
                if (e.target.id === modalId) modal.remove();
            });

        } catch (error) {
            console.error('Error showing project details:', error);
            showMessage(adminContent.querySelector('#admin-message-area-dashboard'), `Error: ${error.message}`, 'error');
        }
    }


    async function handleDeleteProject(projectId, projectName) {
        if (!confirm(`Apakah Anda yakin ingin menghapus proyek "${projectName}"? Aksi ini tidak dapat dibatalkan.`)) {
            return;
        }
        const dashboardMessageContainer = adminContent.querySelector('#admin-message-area-dashboard');
        try {
            const response = await fetch(`/api/admin/projects/${projectId}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${authToken}` }
            });
            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.message || 'Gagal menghapus proyek');
            }
            showMessage(dashboardMessageContainer, data.message, 'success');
            fetchAdminProjects(); // Refresh list
        } catch (error) {
            console.error('Error deleting project:', error);
            showMessage(dashboardMessageContainer, `Error: ${error.message}`, 'error');
        }
    }

    if (adminContent) {
        if (authToken) {
            renderAdminDashboard();
        } else {
            renderLoginForm();
        }
    }
});