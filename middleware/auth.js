const jwt = require('jsonwebtoken');
const User = require('../models/user');
require('dotenv').config();

const protect = async (req, res, next) => {
    let token;

    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        try {
            token = req.headers.authorization.split(' ')[1];
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            if (decoded) { // Check if decoded token exists
                 const user = await User.findById(decoded.id).select('-password');
                 if (!user || user.role !== 'admin') {
                    return res.status(403).json({ message: 'User is not an admin' });
                 }
                 req.user = user;
                 next();
            } else {
                 res.status(401).json({ message: 'Not authorized, token failed' });
            }

        } catch (error) {
            console.error(error);
            res.status(401).json({ message: 'Not authorized, token failed' });
        }
    }

    if (!token) {
        res.status(401).json({ message: 'Not authorized, no token' });
    }
};

module.exports = { protect };