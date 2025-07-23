const dotenv = require("dotenv");
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const debug = require('debug')('lighting-map');
const webpush = require('web-push');

// Import configurations
const connectDB = require('./config/database');

// Import middleware
const authenticateToken = require('./middleware/auth');

// Load environment variables
const envFile = process.env.NODE_ENV === 'production' ? '.env.production' : '.env.development';
dotenv.config({ path: path.resolve(__dirname, envFile) });

// Import routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const townHallRoutes = require('./routes/townHalls');
const lightPointRoutes = require('./routes/lightPoints');
const reportRoutes = require('./routes/reports');
const operationRoutes = require('./routes/operations');
const emailRoutes = require('./routes/email');
const mapsRoutes = require('./routes/maps');
const accessLogsRoutes = require('./routes/accessLogs');
const maintenanceRoutes = require('./routes/maintenance');
const pushRoutes = require('./routes/push');

const app = express();




// Middleware
app.use(bodyParser.json({limit: "50mb"}));

const RateLimit = require("express-rate-limit");
const limiter = RateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 50,
});

app.use(limiter);

// CORS configuration
let corsOptions;
if (process.env.NODE_ENV === 'production') {
    corsOptions = {
        origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : [
            ''
        ],
        methods: ['GET', 'POST', 'DELETE', 'OPTIONS', 'PATCH'],
        allowedHeaders: ['Authorization', 'Content-Type'],
        credentials: false
    };
} else {
    // In dev, allow all origins
    corsOptions = {
        origin: true,
        methods: ['GET', 'POST', 'DELETE', 'OPTIONS', 'PATCH'],
        allowedHeaders: ['Authorization', 'Content-Type'],
        credentials: false
    };
}
console.log(process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
webpush.setVapidDetails(
    `mailto:${process.env.ADMIN_EMAIL}`,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
);
app.options('*', cors(corsOptions));
app.use(cors(corsOptions));

// Connect to database
connectDB();

// PUBLIC ROUTES (no authentication required)
// =========================================

// Auth routes (login, registration, etc.)
app.use('/', authRoutes);
// Maintenance routes (cron job for cleaning up the database) 
// NOTE: protected by basic auth not jwt
app.use('/api/maintenance', maintenanceRoutes);

// PROTECTED ROUTES (authentication required)
// =========================================

app.use(authenticateToken);

// User management routes
app.use('/users', userRoutes);

// Town halls routes
app.use('/townHalls', townHallRoutes);

// Light points routes
app.use('/townHalls/lightPoints', lightPointRoutes);

// Reports routes
app.use('/', reportRoutes);

// Operations routes
app.use('/', operationRoutes);

// Email routes
app.use('/', emailRoutes);

// Maps routes
app.use('/maps', mapsRoutes);

// Access logs routes
app.use('/api/access-logs', accessLogsRoutes);

// Push notifications routes
app.use('/api/push', pushRoutes);

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT,"0.0.0.0",() => {
    debug(`Server is running on port ${PORT}`);
});