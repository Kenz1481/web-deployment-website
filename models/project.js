const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
    reviewerName: {
        type: String,
        required: true,
        default: 'Anonymous'
    },
    rating: {
        type: Number,
        required: true,
        min: 1,
        max: 5
    },
    comment: {
        type: String,
        required: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

const projectSchema = new mongoose.Schema({
    projectName: {
        type: String,
        required: [true, 'Project name is required'],
        trim: true
    },
    description: {
        type: String,
        trim: true
    },
    repoUrl: {
        type: String,
        trim: true,
    },
    subdomain: {
        type: String,
        trim: true,
        unique: true,
        sparse: true 
    },
    deploymentUrl: {
        type: String,
        trim: true
    },
    status: {
        type: String,
        enum: ['pending_setup', 'pending_github', 'pending_deploy', 'deployed', 'error', 'archived'],
        default: 'pending_setup'
    },
    filePath: { // 
        type: String
    },
    vercelProjectId: { 
        type: String
    },
    githubRepoName: { 
        type: String
    },
    logs: [{
        timestamp: { type: Date, default: Date.now },
        message: String,
        type: { type: String, enum: ['info', 'error', 'deploy'], default: 'info' }
    }],
    reviews: [reviewSchema],
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
});
projectSchema.pre('save', function(next) {
    this.updatedAt = Date.now();
    next();
});

projectSchema.pre('findOneAndUpdate', function(next) {
    this.set({ updatedAt: new Date() });
    next();
});


module.exports = mongoose.model('Project', projectSchema);