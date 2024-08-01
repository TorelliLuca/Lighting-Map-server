const mongoose = require('mongoose');
require("dotenv").config()
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const XLSX = require('xlsx');
const nodemailer = require('nodemailer');
const debug = require('debug')('lighting-map');
const debugMail = require('debug')('lighting-map:mail');
const debugDB = require('debug')('lighting-map:DB');

const app = express();
const axios = require('axios');

app.use(bodyParser.json({limit: "50mb"}));

const RateLimit = require("express-rate-limit");
const limiter = RateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 50,
});

app.use(limiter);

const users = require('./schemas/users')
const reports = require('./schemas/reports')
const operations = require('./schemas/operations')
const light_points = require('./schemas/lightPoints')
const townHalls = require('./schemas/townHalls');
const lightPoints = require('./schemas/lightPoints');
const emailLighting = 'sicurezza@torellistudio.com'


app.use(cors({
    origin: ['http://127.0.0.1:5500', 'http://localhost:8080', 'http://localhost:2000', 'http://localhost:5173'],
    methods: ['GET', 'POST', 'DELETE'], // Aggiungi qui i metodi che vuoi consentire
    allowedHeaders: ['Content-Type'], // Aggiungi qui le intestazioni che vuoi consentire
    credentials: true
  }));




mongoose.connect(`mongodb+srv://torelliStudio:${process.env.PASSWORD_DB}@lightingmap.vlfo8t5.mongodb.net/LightingMap?retryWrites=true&w=majority&appName=LightingMap`)


app.get('/maps', async (req, res) => {
    try {
      const response = await axios.get(`https://maps.googleapis.com/maps/api/js?key=${process.env.GOOGLE_MAPS_APY_KEY}&callback=initMap`);
      res.send(response.data);
    } catch (error) {
        debug(error)
      res.status(500).send('Errore nella richiesta alla Google Maps API');
    }
  });

var transporter = nodemailer.createTransport({
host: 'smtps.aruba.it',
port: 465,
secure: true,
  auth: {
    user: emailLighting,
    pass: process.env.PASSWORD_MAIL
  }
});


//modificare la mail in base al tipo di utente --> 
app.post('/send-email-to-user/isApproved', async(req, res) => {
    const username = req.body.user.name
    const htmlEmail = returnHtmlEmail(username)
    var mailOptions = {
        from: `LIGHTING MAP<${emailLighting}>` ,
        to: req.body.to,
        subject: 'Autenticazione su Lighting-map abilitata!',
        html: htmlEmail,
        attachments: [
            {
              filename: 'image-1.png',
              path: './email/images/image-1.png', // sostituisci con il percorso reale
              cid: 'image1' // lo stesso cid verrà utilizzato nel tag img src
            },
            {
                filename: 'image-2.png',
                path: './email/images/image-2.png', // sostituisci con il percorso reale
                cid: 'image2' // lo stesso cid verrà utilizzato nel tag img src
              },
              {
                filename: 'image-3.png',
                path: './email/images/image-3.png', // sostituisci con il percorso reale
                cid: 'image3' // lo stesso cid verrà utilizzato nel tag img src
              },
              {
                filename: 'image-4.png',
                path: './email/images/image-4.png', // sostituisci con il percorso reale
                cid: 'image4' // lo stesso cid verrà utilizzato nel tag img src
              }
          ]
      };
      try {
        let info = await transporter.sendMail(mailOptions);
        debugMail('Email sent: ' + info.response);
        res.status(200).send('Email inviata con successo');
      } catch (error) {
        debugMail(error);
        res.status(400).send('Errore durante l\'invio della mail');
      }
    });

app.post('/send-email-to-user/userNeedValidation', async(req, res) => {
    const username = req.body.user.name
    const htmlEmail = returnHtmlEmailAdmin(username, req.body.user.surname, req.body.user.date)
    var mailOptions = {
        from: `LIGHTING MAP<${emailLighting}>` ,
        to: process.env.ADMIN_EMAIL,
        subject: `Richiesta di autenticazione per ${username} ${req.body.user.surname}`,
        html: htmlEmail,
        attachments: [
            {
                filename: 'image-1.png',
                path: './email/toAdmin/images/image-1.png', // sostituisci con il percorso reale
                cid: 'image1' 
            }
            ]
        };
        try {
        let info = await transporter.sendMail(mailOptions);
        debugMail('Email sent: ' + info.response);
        res.status(200).send('Email inviata con successo');
        } catch (error) {
            debugMail(error);
        res.status(400).send('Errore durante l\'invio della mail');
        }
    });

app.post('/send-email-to-user/lightPointReported', async(req, res) => {
    const th = await townHalls.findOne({name: req.body.name});
    if (!th) res.status(404).send('Comune non trovato, impossibile inviare la mail');

    const destination = await users.find({town_halls_list: th._id,
        user_type: { $in: ['ADMINISTRATOR', 'SUPER_ADMIN']}}).select('email -_id')
    const destinationEmail = destination.map(userEmail => userEmail.email)
    
    debugMail(destinationEmail);

    const username = req.body.user.name
    const htmlEmail = returnHtmlEmailAfterReport(req.body.user, req.body.date, req.body.name,req.body.light_point ,req.body.report)
    
    for (let email of destinationEmail) {
        var mailOptions = {
            from: `LIGHTING MAP - Segnalazione guasti<${emailLighting}>`,
            to: email,
            subject: `Aperta segnalazione sul punto ${req.body.light_point.numero_palo}, ${req.body.name}`,
            html: htmlEmail,
            attachments: [
                {
                    filename: 'image-1.png',
                    path: './email/afterReport/images/image-1.png',
                    cid: 'image1' 
                },
                {
                    filename: 'image-2.png',
                    path: './email/afterReport/images/image-2.png',
                    cid: 'image2' 
                },
                {
                    filename: 'image-3.gif',
                    path: './email/afterReport/images/image-3.gif',
                    cid: 'image3' 
                }
            ]
        };
        try {
            let info = await transporter.sendMail(mailOptions);
            debugMail(`Email sent to ${email}: ` + info.response);
        } catch (error) {
            debugMail(`Error sending email to ${email}: ` + error);
        }
    }
    res.status(200).send('Emails sent');
    
    });

//restituisce l'utente
app.get('/users', async function (req, res) {
    try {
        const usersList = await users.find({});
        res.json(usersList);
    } catch (err) {
        console.error(err);
        res.status(500).send(err);
    }
});
app.get('/users/getNotValidateUsers', async function (req, res) {
    try {
        const usersList = await users.find({is_approved: false});
        res.json(usersList);
    } catch (err) {
        console.error(err);
        res.status(500).send(err);
    }
});

app.get('/users/:id', async function (req, res) {
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


app.get('/users/getForEmail/:email', async function (req, res) {
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



app.post('/users/addPendingUser', async function (req, res) {
    if (!req.body.name || !req.body.surname || !req.body.email || !req.body.password) {
        return res.status(400).send('id, name, surname, email, and password are required');
    }

    try {

        /**controllo che la mail non esista già****/
        const existingUsr = await users.findOne({email: req.body.email});
        if (existingUsr) return res.status(400).send('Email già in uso')
        /******/

        // Crea l'utente con la password hashata
        const newUser = new users({
            name: req.body.name,
            surname: req.body.surname,
            email: req.body.email,
            password: req.body.password,
            //user_type: req.body.user_type,  //prende il valore di default come solo visualizzatore, verrà scelto poi da chi approva la richiesta 
            is_approved: false
        });
        
        await newUser.save();

        res.send("Hai aggiunto un utente");
    } catch (err) {
        console.error(err);
        res.status(500).send('Errore del server');
    }
});

app.post('/users/validateUser', async (req, res) => {
    
    const usrType = req.body.user_type
    const email = req.body.email

    if (!usrType && !email) return res.status(404).send('Email o tipo non valido');
    try{
        const usr = await users.findOne({email: email} );
        if (!usr) return res.status(400).send('user not found');
        
        usr.is_approved = true;
        usr.user_type = usrType;

        await usr.save();

        res.send("Utente validato con successo");
    }catch (e){
        debugDB(e)
        res.status(500).send('Errore del server');
    }
})

app.post('/users/removeUser', async (req, res) => {
    const email = req.body.email

    if (!email) return res.status(404).send('Email non valida');

    try{
        const usr = await users.findOne({email: email} );
        if (!usr) return res.status(400).send('user not found');
        
        await usr.deleteOne();

        res.send('Utente eliminato con successo');
    }catch (e){
        debugDB(e);
        res.status(500).send('errore del server');
    }
})
app.post('/users/update/modifyUser', async (req, res) => {
    const email = req.body.email

    if (!email) return res.status(404).send('Email non valida');

    try{
        const usr = await users.findOne({email: email} );
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
})

app.post('/users/addTownHalls', async (req, res) => {
    try {
      const email = req.body.email;
      const townHallName = req.body.townHall;
  
      // Cerca il comune nel database
      const townHall = await townHalls.findOne({ name: townHallName });
      if (!townHall) {
        return res.status(404).send('Comune non trovato nel database');
      }
  
      // Trova l'utente e verifica se il comune è già presente nell'array town_halls_list
      const user = await users.findOne({email: req.body.email});
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


  app.delete('/users/removeTownHalls', async (req, res) => {
    try {
      const townHallName = req.body.townHall;
      // Cerca il comune nel database
      const townHall = await townHalls.findOne({ name: townHallName });
      if (!townHall) {
        return res.status(404).send('Comune non trovato nel database');
      }
  
      // Trova l'utente e verifica se il comune è già presente nell'array town_halls_list
      const user = await users.findOne({email: req.body.email});
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
  

app.post('/login', async function (req, res) {
    if (!req.body.email || !req.body.password) {
        return res.status(400).send('Email e Password richiesti');
    }

    try {
        const user = await users.findOne({email: req.body.email}).populate('town_halls_list');
        if (!user) {
            return res.status(400).send('Email non valida');
        }
        if(!user.is_approved) return res.status(400).send('Utente non ancora approvato')
        const isMatch = await user.comparePassword(req.body.password);

        if (!isMatch) {
            return res.status(400).send('Password non valida');
        }

        //const token = jwt.sign({ id: user.id, user_type: user.user_type }, 'secret_key', { expiresIn: '1h' });
        res.json({ user });
        // res.cookie('jwtToken', token, {
        //     httpOnly: true,
        //     //secure: true, // Usa solo su connessioni HTTPS
        //     sameSite: 'strict', // Protezione contro attacchi CSRF
        //     expires: new Date(Date.now() + 3600000) // Imposta una scadenza per il cookie
        // });
    } catch (err) {
        console.error(err);
        res.status(500).send('Errore del server');
    }
});


//endpoint per caricare un nuovo comune con i suoi punti
app.post('/townHalls', async (req, res) => {
    try {
        const existingTownHall = await townHalls.findOne({ name: req.body.name });
        if (existingTownHall) {
            return res.status(400).send('Il comune esiste già');
        }

        const th = await townHalls.create({name: req.body.name});

        for (const element of req.body.light_points) {

            const lp = new light_points({
                marker: element.MARKER,
                numero_palo: element.NUMERO_PALO,
                composizione_punto: element.COMPOSIZIONE_PUNTO,
                indirizzo: element.INDIRIZZO,
                lotto: element.LOTTO,
                quadro: element.QUADRO,
                proprieta: element.PROPRIETA,
                tipo_apparecchio: element.TIPO_APPARECCHIO,
                modello: element.MODELLO,
                numero_apparecchi: element.NUMERO_APPARECCHI,
                lampada_potenza: element.LAMPADA_POTENZA,
                tipo_sostegno: element.TIPO_SOSTEGNO,
                tipo_linea: element.TIPO_LINEA,
                promiscuita: element.PROMISCUITA,
                note: element.NOTE,
                garanzia: element.GARANZIA,
                lat: element.lat,
                lng: element.lng,
                pod: element.POD,
                numero_contatore: element.NUMERO_CONTATORE,
                alimentazione: element.ALIMENTAZIONE,
                potenza_contratto: element.POTENZA_CONTRATTO,
                potenza: element.POTENZA,
                punti_luce: element.PUNTI_LUCE,
                tipo: element.TIPO
            });

            await lp.save();
            th.punti_luce.push(lp);
        }
        await th.save();
        res.status(200).send('Comune e punti luce creati con successo');

    } catch (err) {
        console.error(err);
        res.status(500).send('Errore del server');
    }
});

app.delete('/townHalls', async (req, res) => {
    try {
        const townHallName = req.body.name;

        // Cerca il comune nel database
        const townHall = await townHalls.findOne({ name: townHallName });
        if (!townHall) {
            return res.status(404).send('Comune non trovato nel database');
        }

        // Rimuovi tutti i punti luce associati al comune
        if(townHall.punti_luce)
            for (const lpId of townHall.punti_luce) {
                await lightPoints.findByIdAndDelete(lpId);
            }

        await users.updateMany(
            { town_halls_list: townHall._id },
            { $pull: { town_halls_list: townHall._id } }
        );

        // Rimuovi il comune
        await townHalls.findByIdAndDelete(townHall._id);

        res.status(200).send('Comune e punti luce rimossi con successo');

    } catch (err) {
        console.error(err);
        res.status(500).send('Errore del server');
    }
});


// endpoint per aggiornare un comune esistente con i suoi punti
// app.put('/townHalls/updateTownHall', async (req, res) => {
//     try {
//         const th = await townHalls.findOne({name: req.params.name});
//         if (!th) {
//             return res.status(404).send('Il comune non esiste');
//         }

//         for (const element of req.body.light_points) {

//             // Trova il punto luce esistente
//             const lp = await light_points.findById(element._id);
//             if (!lp) {
//                 return res.status(404).send('Il punto luce non esiste');
//             }

//             // Aggiorna le proprietà di lp qui, ad esempio:
//             lp.marker = element.MARKER;
//             lp.numero_palo = element.NUMERO_PALO,
//             lp.composizione_punto= element.COMPOSIZIONE_PUNTO,
//             lp.indirizzo= element.INDIRIZZO,
//             lp.lotto= element.LOTTO,
//             lp.quadro= element.QUADRO,
//             lp.proprieta= element.PROPRIETA,
//             lp.tipo_apparecchio= element.TIPO_APPARECCHIO,
//             lp.modello= element.MODELLO,
//             lp.numero_apparecchi= element.NUMERO_APPARECCHI,
//             lp.lampada_potenza= element.LAMPADA_POTENZA,
//             lp.tipo_sostegno= element.TIPO_SOSTEGNO,
//             lp.tipo_linea= element.TIPO_LINEA,
//             lp.promiscuita= element.PROMISCUITA,
//             lp.note= element.NOTE,
//             lp.garanzia= element.GARANZIA,
//             lp.lat= element.LAT,
//             lp.lng=  element.LNG,
//             lp.pod = element.POD,
//             lp.numero_contatore = element.NUMERO_CONTATORE,
//             lp.alimentazione = element.ALIMENTAZIONE,
//             lp.potenza_contratto= element.POTENZA_CONTRATTO,
//             lp.potenza = element.POTENZA,
//             lp.punti_luce = element.PUNTI_LUCE,
//             lp.tipo = element.TIPO
            

//             await lp.save();
//         }

//         await th.save();
//         res.status(200).send('Comune e punti luce aggiornati con successo');

//     } catch (err) {
//         console.error(err);
//         res.status(500).send('Errore del server');
//     }
// });


app.get('/townHalls', async (req, res) => {
    try {
        const thList = await townHalls.find({}).select('-punti_luce');
        res.json(thList);
    } catch (err) {
        console.error(err);
        res.status(500).send(err);
    }
});

//endpoint per prendere un comune con i suoi punti
// Endpoint per prendere un comune con i suoi punti e segnalazioni
app.get('/townHalls/:name', async (req, res) => {
    try {
        const th = await townHalls.findOne({ name: req.params.name })
            .populate({
                path: 'punti_luce',
                populate: [{
                    path: 'segnalazioni_in_corso',
                    model: 'reports'
                }, {
                    path: 'segnalazioni_risolte',
                    model: 'reports'
                }, {
                    path: 'operazioni_effettuate',
                    model: 'operations',
                    populate: [{ 
                        path: 'operation_point_id',
                        model: 'lightPoints' 
                    }, {
                        path: 'operation_responsible',
                        model: 'users' ,
                        select: 'name surname email'
                    },{
                        path: 'report_to_solve',
                        model: 'reports'
                    }
                
                ]
                }]
            });

        if (th) {
            res.json(th);
        } else {
            res.status(404).send('Comune non trovato');
        }

    } catch (err) {
        console.error(err);
        res.status(500).send('Errore del server');
    }
});

app.get('/townHalls/lightpoints/getActiveReports', async (req, res) => {
    try {
        const { name, numero_palo } = req.query;
        const townHall = await townHalls.findOne({ name })
            .populate({
                path: 'punti_luce',
                match: { numero_palo },
                populate: {
                    path: 'segnalazioni_in_corso',
                    model: 'reports'
                }
            });

        if (townHall && townHall.punti_luce.length > 0) {
            const segnalazioniInCorso = townHall.punti_luce[0].segnalazioni_in_corso;
            res.json(segnalazioniInCorso);
        } else {
            res.status(404).send('Comune o numero_palo non trovato');
        }

    } catch (err) {
        console.error(err);
        res.status(500).send('Errore del server');
    }
});

/*aggiorna comune*/
app.post('/townHalls/update/', async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        let th = await townHalls.findOne({ name: req.body.name }).populate('punti_luce');

        if (!th) {
            res.status(404).send('comune non trovato');
        }


        // Crea un array di _id dai punti luce in arrivo
        const incomingLightPointsIds = req.body.light_points.map(lp => lp._id);

        // Trova i punti luce che sono stati eliminati
        const deletedLightPoints = th.punti_luce.filter(lp => !incomingLightPointsIds.includes(lp._id.toString()));

        // Rimuovi i punti luce che sono stati eliminati
        th.punti_luce = th.punti_luce.filter(lp => incomingLightPointsIds.includes(lp._id.toString()));

        // Elimina i punti luce dal database
        for (let lp of deletedLightPoints) {
            await lightPoints.findByIdAndDelete(lp._id);
        }
//DELETE FUNZIONA
        for (const element of req.body.light_points) {
            // Cerca il punto luce esistente per _id

            let lp = th.punti_luce.find(punto => punto._id.toString() === element._id);

            if (lp) {
                // Se il punto luce esiste, aggiorna i suoi dati
                const { segnalazioni_in_corso, segnalazioni_risolte, operazioni_effettuate, ...rest } = element;
            
                let lowerCaseRest = Object.keys(rest).reduce((newObj, key) => {
                    newObj[key.toLowerCase()] = rest[key];
                    return newObj;
                }, {});
            
                // Aggiorna il documento utilizzando Mongoose
                try {
                    await lp.updateOne(lowerCaseRest);
                } catch (err) {
                    console.error('Errore durante l\'aggiornamento del punto luce:', err);
                }
            }
             else {
                // Se il punto luce non esiste, creane uno nuovo
                lp = new light_points({
                    marker: element.MARKER,
                    numero_palo: element.NUMERO_PALO,
                    composizione_punto: element.COMPOSIZIONE_PUNTO,
                    indirizzo: element.INDIRIZZO,
                    lotto: element.LOTTO,
                    quadro: element.QUADRO,
                    proprieta: element.PROPRIETA,
                    tipo_apparecchio: element.TIPO_APPARECCHIO,
                    modello: element.MODELLO,
                    numero_apparecchi: element.NUMERO_APPARECCHI,
                    lampada_potenza: element.LAMPADA_POTENZA,
                    tipo_sostegno: element.TIPO_SOSTEGNO,
                    tipo_linea: element.TIPO_LINEA,
                    promiscuita: element.PROMISCUITA,
                    note: element.NOTE,
                    garanzia: element.GARANZIA,
                    lat: element.LAT,
                    lng: element.LNG,
                    pod: element.POD,
                    numero_contatore: element.NUMERO_CONTATORE,
                    alimentazione: element.ALIMENTAZIONE,
                    potenza_contratto: element.POTENZA_CONTRATTO,
                    potenza: element.POTENZA,
                    punti_luce: element.PUNTI_LUCE,
                    tipo: element.TIPO
                });
                
                th.punti_luce.push(lp);
            }
            await lp.save();
        }
        
        await th.save({ session });
        await session.commitTransaction();
        res.status(200).send('Comune e punti luce aggiornati con successo');

    } catch (err) {
        await session.abortTransaction();
        console.error(err);
        res.status(500).send('Errore del server');
    } finally {
        session.endSession();
    }
});



app.get('/townHalls/lightpoints/getPoint/', async (req, res) => {
    try {
        const { name, numero_palo } = req.query;

        if (!name || !numero_palo) {
            return res.status(400).send('Nome del comune e numero del palo sono richiesti.');
        }

        const townHall = await townHalls.findOne({ name }).populate({
            path: 'punti_luce',
            match: { numero_palo: numero_palo },
        });

        if (!townHall || !townHall.punti_luce || townHall.punti_luce.length === 0) {
            return res.status(404).send('Palo non trovato.');
        }

        const pl = townHall.punti_luce[0]

        res.json(pl);
    } catch (err) {
        console.error(err);
        res.status(500).send('Errore del server');
    }
});


app.post('/townHalls/lightPoints/update/:_id', async (req, res) => {
    const type = req.body.user_type;
    if(type !== "SUPER_ADMIN") {
        return res.status(403).send("Accesso negato, non possiedi i diritti necessari!");
    }

    const _id = req.params._id; 
    const lpToUpdate = req.body.light_point; 

    try {
        const updatedLP = await lightPoints.findOneAndUpdate(
            { _id: _id }, 
            lpToUpdate, 
            { new: true } 
        );

        if (!updatedLP) {
            return res.status(404).send("Punto luce non trovato.");
        }

        res.send(updatedLP); 
    } catch (error) {
        res.status(500).send("Errore del server: " + error.message);
    }
});


/**
 * body della request:
 * 
 */
app.post('/addReport', async (req, res) => {
    try {
        const th = await townHalls.findOne({ name: req.body.name });

        if (!th) {
            return res.status(404).send('Comune non trovato');
        }

        const ids = th.punti_luce;

        // Ottieni tutti i punti luce completi
        const puntiLuce = await getAllPuntiLuce(ids);

        // Trova il punto luce specifico
        const puntoLuce = puntiLuce.find(punto => {
            if (punto) {
                return punto.numero_palo === req.body.numero_palo; // Restituisce un valore booleano
            } else {
                return false;
            }
        });
        if (!puntoLuce) {
            return res.status(404).send('Punto luce non trovato');
        }

        // Aggiungi la segnalazione al punto luce
        const nuovaSegnalazione = new reports({
            report_type: req.body.report_type,
            description: req.body.description,
            report_date: req.body.date 
        });

        puntoLuce.segnalazioni_in_corso.push(nuovaSegnalazione);

        await nuovaSegnalazione.save();

        await light_points.updateOne({_id: puntoLuce.id}, {$set: {segnalazioni_in_corso: puntoLuce.segnalazioni_in_corso}});
            
        // Salva le modifiche nel database
        await townHalls.updateOne({ name: req.body.name }, { $set: { punti_luce: th.punti_luce } });

        res.send('Segnalazione aggiunta con successo');

    } catch (error) {
        console.error(error);
        res.status(500).send('Errore del server');
    }
});


/*deve trovare il comune
    trovare il punto luce indicato

*/
app.post('/addOperation', async (req, res) => {
    try {

        const th = await townHalls.findOne({ name: req.body.name });

        if (!th) {
            return res.status(404).send('Comune non trovato');
        }

        const ids = th.punti_luce;

        const puntiLuce = await getAllPuntiLuce(ids);

        const puntoLuce = puntiLuce.find(punto => {
            if (punto) {
                return punto.numero_palo === req.body.numero_palo; // Restituisce un valore booleano
            } else {
                return false;
            }
        });
        if (!puntoLuce) {
            return res.status(404).send('Punto luce non trovato');
        }

        const user = await users.findOne({email: req.body.email});
        if (!user) {
            return res.status(404).send('utente non trovato');
        }

        await puntoLuce.populate('segnalazioni_in_corso');


        const report = await puntoLuce.segnalazioni_in_corso.find(segnalazione =>{
            if (segnalazione){

                return segnalazione._id == req.body.id_segnalazione;
            }else{
                return false;
            }
        });


        if(!report && req.body.id_segnalazione !== null){
            return res.status(404).send('segnalazione non trovata');
        }
        const fakeReport = {
            _id: new mongoose.Types.ObjectId(),
            description: "Operazione effettuata senza segnalazione"
        }
        const nuovaOperazione = new operations({
            operation_point_id: puntoLuce._id,
            operation_responsible: user,
            operation_type: req.body.operation_type,
            note: req.body.note,
            report_to_solve: report? report: fakeReport,
            is_solved: req.body.is_solved,
            operation_date: req.body.date
        });

        if (req.body.is_solved && report) {

            puntoLuce.segnalazioni_in_corso.pull(report);
            puntoLuce.segnalazioni_risolte.push(report);
        }

        puntoLuce.operazioni_effettuate.push(nuovaOperazione);

        await nuovaOperazione.save();

        await light_points.updateOne({ _id: puntoLuce._id }, { $set: { operazioni_effettuate: puntoLuce.operazioni_effettuate, segnalazioni_in_corso: puntoLuce.segnalazioni_in_corso, segnalazioni_risolte: puntoLuce.segnalazioni_risolte } });

        // Salva le modifiche nel database
        await townHalls.updateOne({ name: req.body.name }, { $set: { punti_luce: th.punti_luce } });
        res.send('Operazione aggiunta con successo');
    } catch (error) {
        console.error(error);
        res.status(500).send('Errore del server');
    }
});

app.post('/api/downloadExcelReport', function (req, res) {
    
    const jsonData = req.body;
    const workbook = XLSX.utils.book_new();

    const segnalazioniInCorsoWS = XLSX.utils.json_to_sheet(jsonData.segnalazioni_in_corso);
    XLSX.utils.book_append_sheet(workbook, segnalazioniInCorsoWS, 'Segnalazioni In Corso');

    const segnalazioniRisolteWS = XLSX.utils.json_to_sheet(jsonData.segnalazioni_risolte);
    XLSX.utils.book_append_sheet(workbook, segnalazioniRisolteWS, 'Segnalazioni Risolte');

    const operazioniEffettuateWS = XLSX.utils.json_to_sheet(jsonData.operazioni_effettuate);
    XLSX.utils.book_append_sheet(workbook, operazioniEffettuateWS, 'Operazioni Effettuate');
    

    // Invece di scrivere su disco, invia il file al client
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    res.set({
        'Content-Disposition': 'attachment; filename="output.xlsx"',
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    res.send(buffer);
});
    
app.post('/api/downloadExcelTownHall', function (req, res) {
    const jsonData = req.body;
    // Appiattisci l'oggetto JSON
    const cleanedJson = jsonData.punti_luce.map(lp => ({...lp, name: jsonData.name})).map(({ segnalazioni_in_corso, segnalazioni_risolte, operazioni_effettuate, name, __v, ...item }) => item).map(item => Object.fromEntries(Object.entries(item).map(([key, value]) => key === '_id' ? [key, value] : [key.toUpperCase(), value])));

    const workbook = XLSX.utils.book_new();

    const townHallWS = XLSX.utils.json_to_sheet(cleanedJson);
    XLSX.utils.book_append_sheet(workbook, townHallWS, jsonData.name);
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    res.set({
        'Content-Disposition': 'attachment; filename="output.xlsx"',
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    res.send(buffer);
});


async function getPuntoLuceById(id) {
    try {
        const puntoLuce = await light_points.findById(id);
        return puntoLuce;
    } catch (error) {
        console.error('Errore nel recuperare il punto luce:', error);
        return null;
    }
}
async function getAllPuntiLuce(ids) {
    try {
        const puntiLuce = await Promise.all(ids.map(id => getPuntoLuceById(id)));
        return puntiLuce;
    } catch (error) {
        console.error('Errore nel recuperare i punti luce:', error);
        return [];
    }
}






app.listen(3000, ()=>{
    debug("Server is running on port 3000")
})

const emailTemplate = require('./emailBodies');
const emailTemplateAdmin = require('./email/toAdmin/htmlText');
const emailTemplateAfterReport = require('./email/afterReport/htmlText');


function returnHtmlEmail(username) {
  const htmlEmail = emailTemplate.replace('USERNAME', username);
  return htmlEmail;
}

function returnHtmlEmailAdmin(username, surname, date) {
    let htmlEmail = emailTemplateAdmin.replace(/USERNAME/g, username);
    htmlEmail = htmlEmail.replace(/COGNOME/g, surname);
    const formattedDate = formatDate(date);
    htmlEmail = htmlEmail.replace(/DATA/g, formattedDate);
    return htmlEmail;
}

function returnHtmlEmailAfterReport(user,date, thName, pl, report) {
    let htmlEmail = emailTemplateAfterReport.replace(/USERNAME/g, user.name);
    htmlEmail = htmlEmail.replace(/COGNOME/g, user.surname);
    const formattedDate = formatDate(date);
    htmlEmail = htmlEmail.replace(/DATA/g, formattedDate);
    htmlEmail = htmlEmail.replace(/NOME_COMUNE/g, thName);
    htmlEmail = htmlEmail.replace(/USER_EMAIL/g, user.email);
    htmlEmail = htmlEmail.replace(/USER_TELNUMB/g, user.cell);

    htmlEmail = htmlEmail.replace(/NUMERO_PALO/g, pl.numero_palo);
    htmlEmail = htmlEmail.replace(/INDIRIZZO/g, pl.indirizzo);

    htmlEmail = htmlEmail.replace(/CORPO_SEGNALAZIONE/g, report.report_type);
    htmlEmail = htmlEmail.replace(/NOTA/g, report.description);

    return htmlEmail;
}





function formatDate(isoString) {
    let data = new Date(isoString);
    return data.toLocaleDateString('it-IT', {
        day: '2-digit',
        month: 'long', 
        year: 'numeric', 
        hour: '2-digit', 
        minute: '2-digit',
    });
}