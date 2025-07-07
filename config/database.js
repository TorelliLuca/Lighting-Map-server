const mongoose = require('mongoose');
const debugDB = require('debug')('lighting-map:DB');

const connectDB = async () => {
    try {
        await mongoose.connect(`mongodb+srv://torelliStudio:${process.env.PASSWORD_DB}@lightingmap.vlfo8t5.mongodb.net/${process.env.NAME_DB}?retryWrites=true&w=majority&appName=LightingMap`);
        debugDB('MongoDB connected successfully');
    } catch (error) {
        debugDB('MongoDB connection error:', error);
        process.exit(1);
    }
};

module.exports = connectDB; 