const dotenv = require("dotenv");
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const debug = require('debug')('lighting-map');

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
const corsOptions = {
    origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : ['http://localhost:3000', 'http://localhost:5173', 'http://localhost:5174'],
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS', 'PATCH'], 
    allowedHeaders: ['Authorization','Content-Type'], 
    credentials: false
};
console.log(corsOptions)
app.options('*', cors(corsOptions));
app.use(cors(corsOptions));

// Connect to database
connectDB();

// PUBLIC ROUTES (no authentication required)
// =========================================

// Auth routes (login, registration, etc.)
app.use('/', authRoutes);

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

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    debug(`Server is running on port ${PORT}`);
});