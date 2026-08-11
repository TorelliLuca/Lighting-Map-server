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
const authenticateForRefresh = require('./middleware/refreshAuth');
const { handleRefreshToken } = require('./utils/refreshTokenHandler');

// Load environment variables
const envFile = process.env.NODE_ENV === 'production' ? '.env.production' : '.env.development';
dotenv.config({ path: path.resolve(__dirname, envFile) });

// Import routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const townHallRoutes = require('./routes/townHalls');
const lightPointRoutes = require('./routes/lightPoints');
const topologyRoutes = require('./routes/topology');
const reportRoutes = require('./routes/reports');
const operationRoutes = require('./routes/operations');
const emailRoutes = require('./routes/email');
const mapsRoutes = require('./routes/maps');
const accessLogsRoutes = require('./routes/accessLogs');
const maintenanceRoutes = require('./routes/maintenance');
const pushRoutes = require('./routes/push');
const organizationsRoutes = require('./routes/organizations');
const bordersRoutes = require('./routes/borders');
const notificationsRoutes = require('./routes/notifications');
const maintenanceConfigRoutes = require('./routes/maintenanceConfig');
const inspectionsRoutes = require('./routes/inspections');
const quotesRoutes = require('./routes/quotes');

const app = express();




// Middleware
app.use(bodyParser.json({limit: "50mb"}));

const RateLimit = require("express-rate-limit");
const limiter = RateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 500,
});

app.use(limiter);

// CORS configuration
let corsOptions;
if (process.env.NODE_ENV === 'production') {
    corsOptions = {
        origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : [
            ''
        ],
        methods: ['GET', 'POST', 'DELETE', 'PUT', 'OPTIONS', 'PATCH'],
        allowedHeaders: ['Authorization', 'Content-Type'],
        exposedHeaders: ['Content-Disposition'],
        credentials: false
    };
} else {
    // In dev, allow all origins
    corsOptions = {
        origin: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
        allowedHeaders: ['Authorization', 'Content-Type'],
        exposedHeaders: ['Content-Disposition'],
        credentials: false
    };
}
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

// Immagini usate nei template email (devono essere raggiungibili dai client mail)
const { ASSETS_DIR, PUBLIC_MOUNT, ensureAssetsDir } = require('./utils/emailAssets');
ensureAssetsDir();
app.use(PUBLIC_MOUNT, express.static(ASSETS_DIR, {
    maxAge: '7d',
    fallthrough: false,
}));

// Auth routes (login, registration, etc.)
app.use('/', authRoutes);
// Refresh token accetta JWT scaduti entro la finestra di grazia (prima del middleware auth)
app.post('/users/refresh-token', authenticateForRefresh, handleRefreshToken);
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

// Topology (electrical radial network) routes
app.use('/topology', topologyRoutes);

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

// In-app notifications
app.use('/api/notifications', notificationsRoutes);

app.use('/organizations', organizationsRoutes);

app.use('/borders', bordersRoutes);

// Maintenance capitolato / catalogo materiali per comune
app.use('/api/maintenance-config', maintenanceConfigRoutes);

// Sopralluoghi manutenzione ordinaria
app.use('/api/inspections', inspectionsRoutes);

// Preventivi IMS
app.use('/api/quotes', quotesRoutes);

// Impostazioni email / newsletter (SUPER_ADMIN)
const emailSettingsRoutes = require('./routes/emailSettings');
app.use('/api/email-settings', emailSettingsRoutes);

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT,"0.0.0.0",() => {
    debug(`Server is running on port ${PORT}`);
});