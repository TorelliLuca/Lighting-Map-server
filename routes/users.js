const express = require('express');
const users = require('../schemas/users');
const townHalls = require('../schemas/townHalls');
const debugDB = require('debug')('lighting-map:DB');
const { toCsvItalianStyle } = require('../utils/utility');
const { parse } = require('json2csv');
const accessLogger = require('../middleware/accessLogger');
const router = express.Router();
const jwt = require('jsonwebtoken');

// User validation
router.post('/validateUser', async (req, res) => {
    const usrType = req.body.user_type
    const email = req.body.email

    if (!usrType && !email) return res.status(404).send('Email o tipo non valido');
    try{
        const usr = await users.findOne({email: {$eq: email}} );
        if (!usr) return res.status(400).send('user not found');
        
        usr.is_approved = true;
        usr.user_type = usrType;

        await usr.save();

        res.send("Utente validato con successo");
    }catch (e){
        debugDB(e)
        res.status(500).send('Errore del server');
    }
});

router.post('/removeUser', async (req, res) => {
    const email = req.body.email

    if (!email) return res.status(404).send('Email non valida');

    try{
        const usr = await users.findOne({email: {$eq: email}} );
        if (!usr) return res.status(400).send('user not found');
        
        await usr.deleteOne();

        res.send('Utente eliminato con successo');
    }catch (e){
        debugDB(e);
        res.status(500).send('errore del server');
    }
});

router.post('/update/modifyUser', async (req, res) => {
    const email = req.body.email

    if (!email) return res.status(404).send('Email non valida');

    try{
        const usr = await users.findOne({email:{ $eq: email}} );
        if (!usr) return res.status(400).send('user not found');
        
        usr.name = req.body.name;
        usr.surname = req.body.surname;
        usr.user_type = req.body.user_type; 
        
        if (req.body.password) {
            usr.password = req.body.password;
        }

        await usr.save();

        res.send('Utente modificato con successo');
    }catch (e){
        debugDB(e);
        res.status(500).send('errore del server');
    }
});

router.post('/addTownHalls', async (req, res) => {
    try {
      const email = req.body.email;
      const townHallName = req.body.townHall;
  
      // Cerca il comune nel database
      const townHall = await townHalls.findOne({ name: {$eq: townHallName} });
      if (!townHall) {
        return res.status(404).send('Comune non trovato nel database');
      }
  
      // Trova l'utente e verifica se il comune è già presente nell'array town_halls_list
      const user = await users.findOne({email: {$eq: req.body.email}});
      if (!user) {
        return res.status(404).send('Utente non trovato');
      }
      if (!user.is_approved) return res.status(404).send('L\'utente non è ancora stato approvato');
      if (user.town_halls_list.some(town => town.equals(townHall._id))) {
        return res.status(409).send('Comune già presente nella lista dell\'utente');
      }
  
      user.town_halls_list.push(townHall._id);
      await user.save(); 
  
      res.status(200).send('Comune aggiunto con successo!');

    } catch (error) {
      res.status(500).send(error.message);
    }
});

router.delete('/removeTownHalls', async (req, res) => {
    try {
      const townHallName = req.body.townHall;
      // Cerca il comune nel database
      const townHall = await townHalls.findOne({ name: {$eq: townHallName} });
      if (!townHall) {
        return res.status(404).send('Comune non trovato nel database');
      }
  
      // Trova l'utente e verifica se il comune è già presente nell'array town_halls_list
      const user = await users.findOne({email: {$eq: req.body.email}});
      if (!user) {
        return res.status(404).send('Utente non trovato');
      }
      if (!user.is_approved) return res.status(404).send('L\'utente non è ancora stato approvato');
      
      const townHallIndex = user.town_halls_list.findIndex(town => town.equals(townHall._id));
      if (townHallIndex === -1) {
        return res.status(409).send('Comune non presente nella lista dell\'utente');
      }
  
      user.town_halls_list.splice(townHallIndex, 1);
      await user.save(); 
  
      res.status(200).send('Comune rimosso con successo!');
  
    } catch (error) {
      res.status(500).send(error.message);
    }
});

router.get('/', async function (req, res) {
    try {
        const usersList = await users.find({});
        res.json(usersList);
    } catch (err) {
        console.error(err);
        res.status(500).send(err);
    }
});

router.get('/getNotValidateUsers', async function (req, res) {
    try {
        const usersList = await users.find({is_approved: false});
        res.json(usersList);
    } catch (err) {
        console.error(err);
        res.status(500).send(err);
    }
});

router.get('/:id', async function (req, res) {
    try {
        const user = await users.findOne({id: req.params.id});
        if (user) {
            res.json(user);
        } else {
            res.status(404).send('Utente non trovato');
        }
    } catch (err) {
        console.error(err);
        res.status(500).send(err);
    }
});

router.get('/getForEmail/:email', async function (req, res) {
    try {
        const user = await users.findOne({email: req.params.email});
        if (user) {
            res.json(user);
        } else {
            res.status(404).send('Utente non trovato');
        }
    } catch (err) {
        console.error(err);
        res.status(500).send(err);
    }
});

router.get('/profile', accessLogger('GET_PROFILE'), async function (req, res) {
    try {
      const userId = req.user.id;
      
      const user = await users.findOne({ id: userId });
      
      if (user) {
        res.json({ user });
      } else {
        res.status(404).send('User not found');
      }
    } catch (err) {
      console.error('Error fetching user profile:', err);
      res.status(500).send('Server error');
    }
});

router.get('/api/downloadCsv', async function (req, res) {
    try {
        // Popola i nomi dei comuni
        const usersToDownload = await users.find({}).populate('town_halls_list');
        // Prepara i dati per il CSV
        const data = usersToDownload.map(u => ({
            name: u.name,
            surname: u.surname,
            email: u.email,
            user_type: u.user_type,
            is_approved: u.is_approved,
            date: u.date ? u.date.toLocaleString('it-IT') : '',
            comuni: u.town_halls_list && u.town_halls_list.length > 0 ? u.town_halls_list.map(c => c.name).join(', ') : ''
        }));
        const fields = [
            { label: 'Nome', value: 'name' },
            { label: 'Cognome', value: 'surname' },
            { label: 'Email', value: 'email' },
            { label: 'Tipo', value: 'user_type' },
            { label: 'Approvato', value: 'is_approved' },
            { label: 'Data registrazione', value: 'date' },
            { label: 'Comuni associati', value: 'comuni' }
        ];
        const opts = { fields, delimiter: ';', quote: '' };
        const csv = parse(data, opts);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="users.csv"');
        res.send(csv);
    } catch (err) {
        console.error(err);
        res.status(500).send(err);
    }
});

router.post('/refresh-token', (req, res) => {
    // Create a new token with the same user info
    const token = jwt.sign(
        { 
            id: req.user.id,
            email: req.user.email,
            name: req.user.name,
            surname: req.user.surname
        }, 
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN }
    );
    
    res.json({ token });
});

// Endpoint per ottenere la somma totale dei punti luce dei comuni associati a un utente
router.get('/:id/lightPointsCount', async function (req, res) {
    try {
        const user = await users.findById(req.params.id).populate('town_halls_list');
        if (!user) {
            return res.status(404).send('Utente non trovato');
        }
        // Calcola la somma dei punti luce di tutti i comuni associati
        let totalLightPoints = 0;
        const townhalls = [];
        for (const townHall of user.town_halls_list) {
            if (townHall.punti_luce && Array.isArray(townHall.punti_luce)) {
                totalLightPoints += townHall.punti_luce.length;
            }
            if (townHall.name) {
                townhalls.push(townHall.name);
            }
        }
        res.json({ totalLightPoints, townhalls });
    } catch (err) {
        console.error(err);
        res.status(500).send('Errore del server');
    }
});

module.exports = router; 