const jwt = require('jsonwebtoken');

// Define authentication middleware
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; 
    
    if (!token) return res.status(401).send('Accesso negato');
    
    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
      if (err) return res.status(403).send('Token non valido');
      req.user = user;
      next();
    });
};

module.exports = authenticateToken; 