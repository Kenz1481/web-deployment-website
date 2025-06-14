require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/user'); // Adjust path if necessary
const connectDB = require('./config/db'); // Adjust path if necessary

const setupAdminUser = async () => {
    if (!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD) {
        console.error('Error: ADMIN_USERNAME and ADMIN_PASSWORD must be set in the .env file.');
        return;
    }

    await connectDB();

    const adminUsername = process.env.ADMIN_USERNAME;
    const adminPassword = process.env.ADMIN_PASSWORD; // Plain text password from .env

    try {
        let admin = await User.findOne({ username: adminUsername });

        if (admin) {
            console.log(`Admin user '${adminUsername}' already exists.`);
            // Optional: Uncomment to update password if it might have changed in .env
            // console.log(`Checking if password needs update for '${adminUsername}'...`);
            // admin.password = adminPassword; // This will trigger the pre-save hook to re-hash
            // await admin.save();
            // console.log(`Password for admin user '${adminUsername}' has been re-hashed and updated (if changed).`);
        } else {
            console.log(`Admin user '${adminUsername}' not found. Creating...`);
            admin = new User({
                username: adminUsername,
                password: adminPassword, // Will be hashed by pre-save hook in User model
                role: 'admin'
            });
            await admin.save();
            console.log(`Admin user '${adminUsername}' created successfully.`);
        }
        console.log(`Admin setup complete. Username: ${adminUsername}`);

    } catch (error) {
        console.error('Error during admin user setup:', error);
    } finally {
        await mongoose.disconnect();
        console.log('MongoDB disconnected.');
    }
};

setupAdminUser();