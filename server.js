require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs-extra');
const AdmZip = require('adm-zip');
const simpleGit = require('simple-git');
const { Octokit } = require("@octokit/rest");
const fetch = require('node-fetch');

const connectDB = require('./config/db');
const Project = require('./models/project');
const User = require('./models/user');
const { protect } = require('./middleware/auth');
const bcrypt = require('bcryptjs');
const jwt =require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
const VERCEL_API_BASE_URL = 'https://api.vercel.com';
const VERCEL_HEADERS = {
    'Authorization': `Bearer ${process.env.VERCEL_TOKEN}`,
    'Content-Type': 'application/json'
};
if (process.env.VERCEL_TEAM_ID) {
    VERCEL_HEADERS['X-Vercel-Team-Id'] = process.env.VERCEL_TEAM_ID;
}

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

const UPLOADS_DIR = path.join(__dirname, 'uploads');
const DEPLOY_STAGING_DIR = path.join(__dirname, 'deploy_staging');
fs.ensureDirSync(UPLOADS_DIR);
fs.ensureDirSync(DEPLOY_STAGING_DIR);

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, UPLOADS_DIR);
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '-' + file.originalname.replace(/\s+/g, '_'));
    }
});
const upload = multer({ storage: storage });

async function addLogToProject(projectId, message, type = 'info') {
    // Tambahkan pemeriksaan di sini juga untuk projectId
    if (!projectId || typeof projectId !== 'string' || projectId.toLowerCase() === 'undefined' || projectId.length < 12) {
        console.error(`[addLogToProject] Invalid projectId: ${projectId}. Log: "${message}"`);
        return;
    }
    try {
        await Project.findByIdAndUpdate(projectId, {
            $push: { logs: { message, type, timestamp: new Date() } }
        });
    } catch (error) {
        // Jika error adalah CastError, berarti projectId masih salah
        if (error.name === 'CastError' && error.path === '_id') {
            console.error(`[addLogToProject] CastError for projectId: ${projectId}. Log: "${message}"`, error.reason);
        } else {
            console.error(`Failed to add log to project ${projectId}: ${message}`, error);
        }
    }
}

async function initializeAdminUser() {
    try {
        const adminUsername = process.env.ADMIN_USERNAME;
        const adminPassword = process.env.ADMIN_PASSWORD;

        if (!adminUsername || !adminPassword) {
            console.warn('[ADMIN INIT] ADMIN_USERNAME or ADMIN_PASSWORD not set in .env. Skipping admin auto-creation.');
            return;
        }

        const existingAdmin = await User.findOne({ username: adminUsername });
        if (existingAdmin) {
            console.log(`[ADMIN INIT] Admin user '${adminUsername}' already exists.`);
            return;
        }

        console.log(`[ADMIN INIT] Admin user '${adminUsername}' not found. Creating...`);
        const newAdmin = new User({
            username: adminUsername,
            password: adminPassword,
            role: 'admin'
        });
        await newAdmin.save();
        console.log(`[ADMIN INIT] Admin user '${adminUsername}' created successfully.`);

    } catch (error) {
        console.error('[ADMIN INIT] Error during automatic admin user initialization:', error);
    }
}

async function startServer() {
    await connectDB();
    await initializeAdminUser();

    app.post('/api/auth/login', async (req, res) => {
        const { username, password } = req.body;
        console.log(`[AUTH LOGIN] Attempting login for username: "${username}"`);

        if (!username || !password) {
            console.log('[AUTH LOGIN] Username or password not provided in request.');
            return res.status(400).json({ message: 'Username and password are required.' });
        }

        try {
            const user = await User.findOne({ username: username.trim() });

            if (!user) {
                console.log(`[AUTH LOGIN] User not found for username: "${username}"`);
                return res.status(401).json({ message: 'Invalid credentials (user not found)' });
            }

            console.log(`[AUTH LOGIN] User found: ${user.username}, Role: ${user.role}, DB Password Hash: ${user.password ? user.password.substring(0,10) : 'N/A'}...`);

            const isMatch = await user.comparePassword(password);

            if (!isMatch) {
                console.log(`[AUTH LOGIN] Password mismatch for user: "${username}"`);
                return res.status(401).json({ message: 'Invalid credentials (password mismatch)' });
            }

            console.log(`[AUTH LOGIN] Password matched for user: "${username}"`);
            const token = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '1h' });
            
            console.log(`[AUTH LOGIN] Token generated. Login successful for "${username}".`);
            res.json({ 
                message: "Login successful",
                token,
                user: { username: user.username, role: user.role }
            });

        } catch (error) {
            console.error('[AUTH LOGIN] Server error during login:', error);
            res.status(500).json({ message: 'Server error during login' });
        }
    });

    app.get('/api/admin/debug/users', protect, async (req, res) => {
        if (!req.user || req.user.role !== 'admin') {
            return res.status(403).json({ message: 'Forbidden: Admin access required.' });
        }
        try {
            const users = await User.find({}).select('-password');
            console.log('[DEBUG USERS] Admin requested user list.');
            res.json(users);
        } catch (error) {
            console.error('[DEBUG USERS] Error fetching users:', error);
            res.status(500).json({ message: 'Error fetching users list.' });
        }
    });

    app.get('/api/projects', async (req, res) => {
        try {
            const projects = await Project.find({ status: 'deployed' })
                .sort({ createdAt: -1 })
                .select('-logs -filePath');
            res.json(projects);
        } catch (err) {
            console.error(err);
            res.status(500).send('Server Error');
        }
    });

    app.get('/api/projects/:id', async (req, res) => {
        const projectIdFromParam = req.params.id;
        console.log(`[GET PROJECT /api/projects/:id] Received projectId from param: ${projectIdFromParam}`);
        if (!projectIdFromParam || typeof projectIdFromParam !== 'string' || projectIdFromParam.toLowerCase() === 'undefined' || projectIdFromParam.length < 12) {
             console.error(`[GET PROJECT] Invalid projectId in param: ${projectIdFromParam}`);
             return res.status(400).json({ message: 'Invalid project ID format.' });
        }
        try {
            const project = await Project.findById(projectIdFromParam).select('-logs -filePath');
            if (!project) return res.status(404).json({ message: 'Project not found' });
            res.json(project);
        } catch (err) {
            if (err.name === 'CastError') {
                console.error(`[GET PROJECT] CastError for projectId: ${projectIdFromParam}`, err.reason);
                return res.status(400).json({ message: 'Invalid project ID format (cast error).' });
            }
            console.error(err);
            res.status(500).send('Server Error');
        }
    });

    app.post('/api/projects/:id/reviews', async (req, res) => {
        const projectIdFromParam = req.params.id;
        console.log(`[POST REVIEW /api/projects/:id/reviews] Received projectId from param: ${projectIdFromParam}`);
        if (!projectIdFromParam || typeof projectIdFromParam !== 'string' || projectIdFromParam.toLowerCase() === 'undefined' || projectIdFromParam.length < 12) {
             console.error(`[POST REVIEW] Invalid projectId in param: ${projectIdFromParam}`);
             return res.status(400).json({ message: 'Invalid project ID format.' });
        }
        const { reviewerName, rating, comment } = req.body;
        try {
            const project = await Project.findById(projectIdFromParam);
            if (!project) return res.status(404).json({ message: 'Project not found' });
            project.reviews.push({ reviewerName, rating, comment });
            await project.save();
            res.status(201).json(project.reviews[project.reviews.length - 1]);
        } catch (err) {
            if (err.name === 'CastError') {
                console.error(`[POST REVIEW] CastError for projectId: ${projectIdFromParam}`, err.reason);
                return res.status(400).json({ message: 'Invalid project ID format (cast error).' });
            }
            console.error(err);
            res.status(500).json({ message: 'Error adding review', error: err.message });
        }
    });

    app.post('/api/admin/projects', protect, upload.single('projectFile'), async (req, res) => {
        const { projectName, description, repoUrl, subdomain } = req.body;
        const adminUser = req.user;

        if (!projectName) {
            return res.status(400).json({ message: 'Project name is required.' });
        }

        let newProjectData = {
            projectName,
            description,
            subdomain: subdomain ? subdomain.toLowerCase().replace(/\s+/g, '-') : projectName.toLowerCase().replace(/\s+/g, '-').substring(0,30),
            repoUrl: repoUrl ? repoUrl.trim() : null,
            status: 'pending_setup',
            logs: [{ message: `Project creation initiated by admin ${adminUser.username}.` }]
        };

        if (req.file) {
            newProjectData.filePath = req.file.path;
            newProjectData.logs.push({ message: `File ${req.file.originalname} uploaded.` });
        }

        try {
            const projectInstance = new Project(newProjectData); // Renamed to projectInstance to avoid confusion
            await projectInstance.save();
            
            console.log(`[ADMIN PROJECTS] Project saved with ID: ${projectInstance._id}, type: ${typeof projectInstance._id}`);
            if (!projectInstance._id) { // This check should ideally never fail if save was successful
                console.error("[ADMIN PROJECTS] CRITICAL: Project saved but _id is missing or undefined!");
                await addLogToProject(projectInstance._id, "CRITICAL: Project created but ID was missing.", "error"); // Won't work if ID is truly missing
                return res.status(500).json({ message: 'Critical error: Project ID missing after save.' });
            }
            
            res.status(201).json({ message: 'Project created. Deployment process initiated.', project: projectInstance });

            // Pass the string version of ObjectId
            processDeploymentPipeline(projectInstance._id.toString()).catch(err => {
                console.error(`[ProcessDeploymentPipeline] Unhandled error for project ${projectInstance._id}:`, err);
                addLogToProject(projectInstance._id.toString(), `Critical pipeline error: ${err.message}`, 'error'); // Ensure ID is string here
                Project.findByIdAndUpdate(projectInstance._id.toString(), { status: 'error' }).exec(); // Ensure ID is string here
            });

        } catch (err) {
            console.error('Error creating project entry:', err);
            if (err.code === 11000) {
                return res.status(400).json({ message: 'Subdomain or Project Name might already exist (if used as unique key).' });
            }
            res.status(500).json({ message: 'Error creating project', error: err.message });
        }
    });
    
    // BARIS 177 KEMUNGKINAN BESAR DIMULAI DARI SINI
    async function processDeploymentPipeline(projectId) { // projectId HARUS STRING ObjectId YANG VALID
        console.log(`[Pipeline START] Received projectId: ${projectId}, type: ${typeof projectId}`);
        if (!projectId || typeof projectId !== 'string' || projectId.toLowerCase() === 'undefined' || projectId.length < 12) {
            console.error(`[Pipeline CRITICAL] Invalid projectId received: "${projectId}". Aborting pipeline.`);
            // Tidak bisa log ke project jika projectId tidak valid untuk query
            return;
        }

        let projectDocument; // Ganti nama variabel untuk menghindari kebingungan dengan 'project' global jika ada
        try {
            projectDocument = await Project.findById(projectId);
        } catch (e) {
            if (e.name === 'CastError') {
                 console.error(`[Pipeline CRITICAL] CastError finding project with ID: "${projectId}". This means the ID format is wrong.`, e.reason);
            } else {
                console.error(`[Pipeline CRITICAL] Error finding project with ID: "${projectId}".`, e);
            }
            // Tidak bisa log ke project jika tidak bisa ditemukan
            return;
        }


        if (!projectDocument) {
            console.error(`[Pipeline CRITICAL] Project document not found for ID: "${projectId}". Aborting pipeline.`);
            // Tidak bisa log ke project jika tidak ditemukan
            return;
        }

        // Mulai dari sini, kita anggap projectDocument adalah objek Mongoose yang valid
        // dan projectId adalah string ObjectId yang valid

        await addLogToProject(projectId, 'Deployment pipeline started.', 'info');
        // Gunakan findByIdAndUpdate untuk memastikan atomicity jika diperlukan, atau save() jika sudah mengambil dokumen
        await Project.findByIdAndUpdate(projectId, { status: 'processing' });
        // projectDocument.status = 'processing'; // Alternatif jika ingin save manual nanti
        // await projectDocument.save();


        const stagingPath = path.join(DEPLOY_STAGING_DIR, projectId); // projectId adalah string _id
        let githubRepoFullName;
        let githubRepoId; 

        try {
            if (projectDocument.filePath) {
                await Project.findByIdAndUpdate(projectId, { status: 'processing_zip' });
                await addLogToProject(projectId, 'Processing uploaded ZIP file.', 'info');

                await fs.ensureDir(stagingPath);
                await fs.emptyDir(stagingPath);

                try {
                    const zip = new AdmZip(projectDocument.filePath);
                    zip.extractAllTo(stagingPath, true);
                    await addLogToProject(projectId, `ZIP file extracted to ${stagingPath}.`, 'info');
                } catch (zipError) {
                    await addLogToProject(projectId, `Failed to extract ZIP: ${zipError.message}`, 'error');
                    await Project.findByIdAndUpdate(projectId, { status: 'error_zip_extraction' });
                    return;
                }

                const repoNameForGithub = `wz-${projectDocument.subdomain || projectDocument.projectName.toLowerCase().replace(/[^a-z0-9-]/g, '-').substring(0, 40)}-${Date.now().toString().slice(-5)}`;
                await Project.findByIdAndUpdate(projectId, { status: 'creating_github_repo' });
                await addLogToProject(projectId, `Attempting to create GitHub repository: ${repoNameForGithub}`, 'info');

                let createdRepo;
                try {
                    const response = await octokit.repos.createForAuthenticatedUser({
                        name: repoNameForGithub,
                        private: true,
                        description: `WanzOFC Deploy: ${projectDocument.projectName} - ${projectDocument.description || ''}`,
                        auto_init: false,
                    });
                    createdRepo = response.data;
                    githubRepoFullName = createdRepo.full_name;
                    githubRepoId = createdRepo.id; 
                    await addLogToProject(projectId, `GitHub repository created: ${createdRepo.html_url} (ID: ${githubRepoId})`, 'info');
                    await Project.findByIdAndUpdate(projectId, { 
                        githubRepoName: githubRepoFullName, 
                        repoUrl: createdRepo.clone_url,
                    });
                } catch (githubError) {
                    console.error("GitHub Repo Creation Error:", githubError.response ? githubError.response.data : githubError.message);
                    await addLogToProject(projectId, `Failed to create GitHub repository: ${githubError.message}`, 'error');
                    await Project.findByIdAndUpdate(projectId, { status: 'error_github_creation' });
                    return;
                }
                
                await Project.findByIdAndUpdate(projectId, { status: 'pushing_to_github' });
                await addLogToProject(projectId, `Initializing local repository and pushing to ${githubRepoFullName}...`, 'info');
                const git = simpleGit(stagingPath);

                try {
                    const readmePath = path.join(stagingPath, 'README.md');
                    const readmeContent = `# ${projectDocument.projectName}\n\nDeployed via WanzOFC Deploy.\nSubdomain: ${projectDocument.subdomain || 'N/A'}\nGitHub Repo: ${createdRepo.html_url}`;
                    await fs.writeFile(readmePath, readmeContent);
                    await addLogToProject(projectId, 'README.md created/updated in staging.', 'info');

                    await git.init();
                    await addLogToProject(projectId, 'Git repository initialized.', 'info');

                    try {
                        console.log(`[GIT CONFIG] Attempting to set local safe.directory for ${stagingPath}`);
                        await git.raw(['config', '--local', 'safe.directory', stagingPath]);
                        await addLogToProject(projectId, `Git config safe.directory set locally for ${stagingPath}.`, 'info');
                        console.log(`[GIT CONFIG] Successfully set local safe.directory for ${stagingPath}`);
                    } catch (configError) {
                        console.error(`[GIT CONFIG CRITICAL] Failed to set local safe.directory: ${configError.message}.`);
                        await addLogToProject(projectId, `CRITICAL Error: Could not set local safe.directory: ${configError.message}. Subsequent Git operations might fail.`, 'error');
                    }

                    await git.add('./*');
                    await addLogToProject(projectId, 'All files added to git staging.', 'info');

                    await git.commit('Initial commit by WanzOFC Deploy');
                    await addLogToProject(projectId, 'Initial commit created.', 'info');

                    await git.branch(['-M', 'main']);
                    await addLogToProject(projectId, 'Branch renamed/set to main.', 'info');

                    const remoteUrl = createdRepo.clone_url.replace('https://', `https://${process.env.GITHUB_USERNAME_FOR_REPOS}:${process.env.GITHUB_TOKEN}@`);
                    const remotes = await git.getRemotes(true);
                    if (!remotes.find(r => r.name === 'origin')) {
                        await git.addRemote('origin', remoteUrl);
                        await addLogToProject(projectId, 'GitHub remote "origin" added.', 'info');
                    } else {
                        await git.remote(['set-url', 'origin', remoteUrl]);
                        await addLogToProject(projectId, 'GitHub remote "origin" URL updated.', 'info');
                    }

                    await git.push(['-u', 'origin', 'main', '--force']);
                    await addLogToProject(projectId, 'Code pushed to GitHub successfully.', 'info');

                } catch (gitError) {
                    console.error("Git Operations Error:", gitError.message, gitError.stack);
                    await addLogToProject(projectId, `Failed during Git operations: ${gitError.message}`, 'error');
                    await Project.findByIdAndUpdate(projectId, { status: 'error_github_push' });
                    return;
                }
                
            } else if (projectDocument.repoUrl) { 
                const match = projectDocument.repoUrl.match(/github\.com\/([^\/]+\/[^\.]+)(\.git)?/);
                if (!match || !match[1]) {
                    await addLogToProject(projectId, `Invalid GitHub repository URL: ${projectDocument.repoUrl}`, 'error');
                    await Project.findByIdAndUpdate(projectId, { status: 'error_invalid_repo_url' });
                    return;
                }
                githubRepoFullName = match[1];
                try {
                    const [owner, repo] = githubRepoFullName.split('/');
                    const repoData = await octokit.repos.get({ owner, repo });
                    githubRepoId = repoData.data.id; 
                    await addLogToProject(projectId, `Using existing GitHub repository: ${githubRepoFullName} (ID: ${githubRepoId})`, 'info');
                } catch (getRepoError) {
                    console.error("Error fetching existing GitHub repo ID:", getRepoError.message);
                    await addLogToProject(projectId, `Error fetching ID for existing GitHub repo ${githubRepoFullName}: ${getRepoError.message}`, 'error');
                    await Project.findByIdAndUpdate(projectId, { status: 'error_github_fetch_id' });
                    return;
                }
                await Project.findByIdAndUpdate(projectId, { githubRepoName: githubRepoFullName, status: 'linking_to_vercel' });
            } else {
                await addLogToProject(projectId, 'No ZIP file or GitHub repository URL provided.', 'warn');
                await Project.findByIdAndUpdate(projectId, { status: 'pending_manual_setup' });
                return;
            }

            if (!githubRepoFullName || !githubRepoId) { 
                 await addLogToProject(projectId, 'GitHub repository details (name or ID) not available for Vercel deployment.', 'error');
                 await Project.findByIdAndUpdate(projectId, { status: 'error_missing_gh_details' });
                 return;
            }

            await Project.findByIdAndUpdate(projectId, { status: 'deploying_to_vercel' });
            await addLogToProject(projectId, `Starting Vercel deployment for ${githubRepoFullName} (ID: ${githubRepoId})...`, 'info');
            
            const vercelProjectName = projectDocument.subdomain || projectDocument.projectName.toLowerCase().replace(/[^a-z0-9-]/g, '-').substring(0,50);

            const vercelDeployPayload = {
                name: vercelProjectName,
                gitSource: {
                    type: 'github',
                    repoId: githubRepoId, 
                    repo: githubRepoFullName, 
                    ref: 'main',
                },
                projectSettings: { 
                    framework: null, 
                    buildCommand: null,
                    installCommand: null,
                    outputDirectory: null,
                    rootDirectory: null, 
                    devCommand: null,
                }
            };
            
            let vercelApiUrl = `${VERCEL_API_BASE_URL}/v13/deployments`;
            if (process.env.VERCEL_TEAM_ID) {
                vercelApiUrl += `?teamId=${process.env.VERCEL_TEAM_ID}`;
            }
            
            try {
                const vercelResponse = await fetch(vercelApiUrl, {
                    method: 'POST',
                    headers: VERCEL_HEADERS,
                    body: JSON.stringify(vercelDeployPayload)
                });

                const vercelData = await vercelResponse.json();

                if (!vercelResponse.ok || vercelData.error) {
                    console.error('Vercel API Error Data:', vercelData);
                    const errorMessage = vercelData.error ? vercelData.error.message : `Vercel API responded with status ${vercelResponse.status}`;
                    throw new Error(errorMessage);
                }
                
                const deploymentUrl = `https://${vercelData.alias && vercelData.alias.length > 0 ? vercelData.alias[0] : vercelProjectName + '.vercel.app'}`;
                const vercelProjectIdFromAPI = vercelData.projectId || (vercelData.project ? vercelData.project.id : null);

                await addLogToProject(projectId, `Vercel deployment initiated. URL (eventually): ${deploymentUrl}. Vercel Project ID: ${vercelProjectIdFromAPI}`, 'deploy');
                await Project.findByIdAndUpdate(projectId, { 
                    status: 'deployed',
                    deploymentUrl: deploymentUrl,
                    vercelProjectId: vercelProjectIdFromAPI
                });

            } catch (vercelError) {
                console.error("Vercel Deployment Error:", vercelError.message);
                await addLogToProject(projectId, `Vercel deployment failed: ${vercelError.message}`, 'error');
                await Project.findByIdAndUpdate(projectId, { status: 'error_vercel_deployment' });
            }

        } catch (pipelineError) {
            console.error(`[Pipeline] Error during pipeline main try block for project ${projectId}:`, pipelineError);
            // Hanya log jika projectId valid, karena findByIdAndUpdate akan gagal jika tidak
            if (projectId && projectId !== "undefined" && projectId.length >=12) {
                await addLogToProject(projectId, `Critical pipeline error: ${pipelineError.message}`, 'error');
                await Project.findByIdAndUpdate(projectId, { status: 'error' }).catch(e => console.error("Failed to update project status to error", e));
            } else {
                console.error(`[Pipeline] Cannot update project status due to invalid projectId: ${projectId}`);
            }
        } finally {
            // Cek filePath dari projectDocument yang valid (jika ada) sebelum menghapus
            if (projectDocument && projectDocument.filePath && await fs.pathExists(projectDocument.filePath)) { 
                await fs.remove(projectDocument.filePath).catch(e => {
                    console.warn(`Could not remove uploaded file ${projectDocument.filePath}`, e);
                    if(projectId && projectId !== "undefined") addLogToProject(projectId, `Warning: Could not remove uploaded file ${projectDocument.filePath}.`, 'warn');
                });
            }
            // stagingPath menggunakan projectId yang string, jadi harus valid
            if (projectId && projectId !== "undefined" && projectId.length >=12 && await fs.pathExists(stagingPath)) { 
               await fs.remove(stagingPath).catch(e => {
                   console.warn(`Could not remove staging path ${stagingPath}`, e);
                   addLogToProject(projectId, `Warning: Could not remove staging directory ${stagingPath}.`, 'warn');
                });
            }
        }
    }

    // ... (sisa route lainnya: GET /api/admin/projects, PUT, DELETE, dll.)
    app.get('/api/admin/projects', protect, async (req, res) => {
        try {
            const projects = await Project.find().sort({ createdAt: -1 });
            res.json(projects);
        } catch (err) {
            console.error(err);
            res.status(500).send('Server Error');
        }
    });

    app.get('/api/admin/projects/:id', protect, async (req, res) => {
        const projectIdFromParam = req.params.id;
        if (!projectIdFromParam || typeof projectIdFromParam !== 'string' || projectIdFromParam.toLowerCase() === 'undefined' || projectIdFromParam.length < 12) {
             return res.status(400).json({ message: 'Invalid project ID format.' });
        }
        try {
            const project = await Project.findById(projectIdFromParam);
            if (!project) return res.status(404).json({ message: 'Project not found' });
            res.json(project);
        } catch (err) {
             if (err.name === 'CastError') return res.status(400).json({ message: 'Invalid project ID format (cast error).' });
            console.error(err);
            res.status(500).send('Server Error');
        }
    });

    app.put('/api/admin/projects/:id', protect, async (req, res) => {
        const projectIdFromParam = req.params.id;
        if (!projectIdFromParam || typeof projectIdFromParam !== 'string' || projectIdFromParam.toLowerCase() === 'undefined' || projectIdFromParam.length < 12) {
             return res.status(400).json({ message: 'Invalid project ID format.' });
        }
        const { projectName, description, status, deploymentUrl } = req.body;
        try {
            let project = await Project.findById(projectIdFromParam);
            if (!project) return res.status(404).json({ message: 'Project not found' });

            project.projectName = projectName !== undefined ? projectName : project.projectName;
            project.description = description !== undefined ? description : project.description;
            project.status = status !== undefined ? status : project.status;
            project.deploymentUrl = deploymentUrl !== undefined ? deploymentUrl : project.deploymentUrl;
            
            project.logs.push({ message: `Project details updated by admin. Status: ${project.status}` });
            const updatedProject = await project.save();
            res.json(updatedProject);
        } catch (err) {
            if (err.name === 'CastError') return res.status(400).json({ message: 'Invalid project ID format (cast error).' });
            if (err.code === 11000) return res.status(400).json({ message: 'Subdomain conflict during update.' });
            console.error('Error updating project:', err);
            res.status(500).json({ message: 'Error updating project', error: err.message });
        }
    });

    app.delete('/api/admin/projects/:id', protect, async (req, res) => {
        const projectIdFromParam = req.params.id;
        if (!projectIdFromParam || typeof projectIdFromParam !== 'string' || projectIdFromParam.toLowerCase() === 'undefined' || projectIdFromParam.length < 12) {
             return res.status(400).json({ message: 'Invalid project ID format.' });
        }
        try {
            const project = await Project.findById(projectIdFromParam);
            if (!project) return res.status(404).json({ message: 'Project not found' });

            const stagingPathProject = path.join(DEPLOY_STAGING_DIR, projectIdFromParam);

            await addLogToProject(projectIdFromParam, `Deletion process initiated for project ${project.projectName}`, 'info');

            if (project.vercelProjectId) {
                // ... (logika hapus Vercel)
                 await addLogToProject(projectIdFromParam, `Attempting to delete Vercel project ID: ${project.vercelProjectId}`, 'info');
                let vercelDeleteUrl = `${VERCEL_API_BASE_URL}/v9/projects/${project.vercelProjectId}`;
                 if (process.env.VERCEL_TEAM_ID) {
                    vercelDeleteUrl += `?teamId=${process.env.VERCEL_TEAM_ID}`;
                }
                try {
                    const vercelDeleteResponse = await fetch(vercelDeleteUrl, { method: 'DELETE', headers: VERCEL_HEADERS });
                    if (!vercelDeleteResponse.ok) {
                        const errorData = await vercelDeleteResponse.json().catch(()=>({error: {message: "Unknown error during Vercel project deletion."}}));
                        console.warn(`Failed to delete Vercel project ${project.vercelProjectId}: ${vercelDeleteResponse.status}`, errorData);
                        await addLogToProject(projectIdFromParam, `Warning: Failed to delete Vercel project (Status: ${vercelDeleteResponse.status}). ${errorData.error?.message || ''}`, 'error');
                    } else {
                        await addLogToProject(projectIdFromParam, `Vercel project ${project.vercelProjectId} deleted successfully.`, 'info');
                    }
                } catch (e) {
                    console.warn(`Error calling Vercel delete API for ${project.vercelProjectId}:`, e);
                    await addLogToProject(projectIdFromParam, `Error during Vercel project deletion: ${e.message}.`, 'error');
                }
            }

            if (project.githubRepoName && project.repoUrl && project.repoUrl.includes(`github.com/${process.env.GITHUB_USERNAME_FOR_REPOS}/wz-`)) {
                // ... (logika hapus GitHub)
                await addLogToProject(projectIdFromParam, `Attempting to delete GitHub repository: ${project.githubRepoName}`, 'info');
                try {
                    const [owner, repo] = project.githubRepoName.split('/');
                    await octokit.repos.delete({ owner, repo });
                    await addLogToProject(projectIdFromParam, `GitHub repository ${project.githubRepoName} deleted successfully.`, 'info');
                } catch (e) {
                    console.warn(`Failed to delete GitHub repo ${project.githubRepoName}:`, e.response ? e.response.data : e.message);
                    await addLogToProject(projectIdFromParam, `Warning: Failed to delete GitHub repo. ${e.message}`, 'error');
                }
            }
            
            if (project.filePath && await fs.pathExists(project.filePath)) {
                await fs.remove(project.filePath).catch(err => console.warn(`Error deleting uploaded file ${project.filePath}:`, err));
            }
            if (await fs.pathExists(stagingPathProject)) {
                await fs.remove(stagingPathProject).catch(err => console.warn(`Error deleting staging folder ${stagingPathProject}:`, err));
            }
            
            await Project.deleteOne({ _id: projectIdFromParam });
            
            res.json({ message: `Project "${project.projectName}" and associated resources deletion process finished.` });

        } catch (err) {
            if (err.name === 'CastError') return res.status(400).json({ message: 'Invalid project ID format (cast error).' });
            console.error('Error deleting project:', err);
            res.status(500).send('Server Error during deletion');
        }
    });


    app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
    app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

    app.listen(PORT, () => console.log(`Server running on port ${PORT}. Ensure .env variables are set.`));
}

startServer().catch(err => {
    console.error("Failed to start server:", err);
    process.exit(1);
});