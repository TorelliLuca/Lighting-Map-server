const express = require('express');
const townHalls = require('../schemas/townHalls');
const operations = require('../schemas/operations');
const light_points = require('../schemas/lightPoints');
const users = require('../schemas/users');
const organizations =  require('../schemas/organizations');
const mongoose = require('mongoose');
const { getAllPuntiLuce } = require('../utils/lightPointHelpers');
const accessLogger = require('../middleware/accessLogger');
const logAccess = require('../utils/accessLogger');
const reports = require('../schemas/reports');
const router = express.Router();    
const { ObjectId } = require('mongodb');


router.get("/my-organization/:organizationId", async (req, res) => {
    try {
        const organizationId = req.params.organizationId;
        const organization = await organizations.findById(organizationId).populate('members').populate('responsible');
        if (!organization) return res.status(404).send( 'Organizzazione non trovata');
        res.status(200).json(organization);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Errore interno' });
    }
});

router.get("/all-organizations", async (req, res) => {
    try {
        const organizationsList = await organizations.find();
        res.status(200).json(organizationsList);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Errore interno' });
    }
});

router.get("/townhall/:townhallId", async (req, res) => {
    try {
        const townhallId = req.params.townhallId;

        if (!mongoose.Types.ObjectId.isValid(townhallId)) {
            return res.status(400).json({ error: 'L\'ID del comune fornito non è valido.' });
        }

        const pipeline = [
            // Stage 1: Filtra le organizzazioni che hanno contratti con l'ID del comune
            {
                $match: {
                    "contracts.townhall_associated": new mongoose.Types.ObjectId(townhallId)
                }
            },
            // Stage 2: Srotola l'array dei contratti per lavorarci su un elemento alla volta
            {
                $unwind: "$contracts"
            },
            // Stage 3: Filtra per mantenere solo i contratti specifici
            {
                $match: {
                    "contracts.townhall_associated": new mongoose.Types.ObjectId(townhallId)
                }
            },
            // Stage 4: "Popula" il campo townhall_associated
            // Stage 6: Popula altri campi, come 'responsible' e 'members'
            {
                $lookup: {
                    from: "users",
                    localField: "responsible",
                    foreignField: "_id",
                    as: "responsible"
                }
            },
            {
                $unwind: { path: "$responsible", preserveNullAndEmptyArrays: true }
            },
            {
                $lookup: {
                    from: "users",
                    localField: "members",
                    foreignField: "_id",
                    as: "members"
                }
            },
            // Stage 7: Raggruppa i documenti per ricostruire l'organizzazione originale
            {
                $group: {
                    _id: "$_id",
                    name: { $first: "$name" },
                    description: { $first: "$description" },
                    created_at: { $first: "$created_at" },
                    updated_at: { $first: "$updated_at" },
                    logo: { $first: "$logo" },
                    type: { $first: "$type" },
                    location: { $first: "$location" },
                    address: { $first: "$address" },
                    responsible: { $first: "$responsible" },
                    townhallId: { $first: "$townhallId" },
                    members: {$first: "$members"},
                    // Ricostruisci l'array dei contratti filtrato e popolato
                    contracts: { $push: "$contracts" }
                },
                

            },
            {
            $sort: {
                name: 1 
            }
        }
        ];
        const options = {
                collation: {
                    locale: 'it',
                    strength: 2
                }
            };

        const orgs = await organizations.aggregate(pipeline, options);

        if (orgs.length === 0) {
            return res.status(404).json({ message: 'Nessuna organizzazione trovata per questo comune.' });
        }

        res.status(200).json(orgs);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Errore interno del server.' });
    }
});


router.post('/add-organization', async (req, res) => {
    try {
        const { contract, name, description, type, logo, location, address, townhall_id } = req.body;
        console.log(location);
        const newOrganization = new organizations({
            name,
            description,
            type,
            logo,
            location,
            address});
        if (contract) {
            newOrganization.contracts.push(contract);
            const townhallToUpdate = await townHalls.findById(contract.associated_townhall_id);
            if (townhallToUpdate) {
                townhallToUpdate.organizations_maintainers.push(newOrganization._id);
                await townhallToUpdate.save();
            }
        }
        if (townhall_id) {
            newOrganization.townhallId = townhall_id;
            townhallToUpdate = await townHalls.findById(townhall_id);
            if (townhallToUpdate) {
                townhallToUpdate.organization_admin = newOrganization._id;
                await townhallToUpdate.save();
            }
        }
        await newOrganization.save();
        res.status(200).json(newOrganization);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Errore interno' });
    }
});

router.put('/add-users-to-organization', async (req, res) => {
    try {
        const { members, organizationId } = req.body;

        const updatedOrganization = await organizations.findByIdAndUpdate(
            organizationId,
            { $addToSet: { members: { $each: members } } },
            { new: true } // Restituisce il documento aggiornato
        );

        if (!updatedOrganization) {
            return res.status(404).send('Organizzazione non trovata');
        }

        const result = await users.updateMany(
            { _id: { $in: members } },
            { $set: { id_organization: organizationId } }
        );

        if (result.modifiedCount === 0) {
            console.warn('Nessun utente aggiornato. ID utente non validi.');
        }
        
        res.status(200).json(updatedOrganization);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Errore interno del server' });
    }
});

router.put('/remove-user-from-organization', async (req, res) => {
    const userId = req.body.userId;
    const organizationId = req.body.organizationId;
    try {
        const updatedOrganization = await organizations.findByIdAndUpdate(
            organizationId,
            { $pull: { members: userId } },
            { new: true } 
        );
        if (!updatedOrganization) {
            return res.status(404).send('Organizzazione non trovata');
        }
        const updatedUser = await users.findByIdAndUpdate(
            userId,
            { $unset: { id_organization: "" } },
            { new: true } 
        );
        if (!updatedUser) {
            return res.status(404).send('Utente non trovato');
        }
        res.status(200).json({ organization: updatedOrganization, user: updatedUser });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Errore interno del server' });
    }
})

router.put("/add-contract-to-organization", async (req, res) => {
    const { organizationId, contract } = req.body;
    console.log(req.body);
    try {
        const organization = await organizations.findById(organizationId);
        console.log(contract);
        if (!organization) return res.status(404).send('Organizzazione non trovata');
        organization.contracts.push(contract);
        await organization.save();
        const townhallToUpdate = await townHalls.findById(contract.townhall_associated);
        if (townhallToUpdate) {
            townhallToUpdate.organizations_maintainers.push(organization._id);
            console.log("organization._id: ", organization._id);
            console.log("organizationId: ", organizationId);
            await townhallToUpdate.save();
        }
        res.status(200).json(organization);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Errore interno del server' });
    }
});

router.put("/associate-townhall-to-organization", async (req, res) => {
    const { organizationId, townhallId } = req.body;
    console.log(organizationId, townhallId);
    //sessione inizio
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const organization = await organizations.findById(organizationId);
        if (!organization) {
            await session.abortTransaction();
            session.endSession();
            return res.status(404).send('Organizzazione non trovata');}
        organization.townhallId = townhallId;
        await organization.save();
        const townhallToUpdate = await townHalls.findById(townhallId);
        if (townhallToUpdate) {
            townhallToUpdate.organization_admin = organization._id;
            await townhallToUpdate.save();
        }else{
            await session.abortTransaction();
            session.endSession();
            return res.status(404).send('Municipio non trovato');
        }
        session.commitTransaction();
        session.endSession();
        res.status(200).json(organization);
        
    } catch (err) {
        console.error(err);
        await session.abortTransaction();
        session.endSession();
        res.status(500).json({ error: 'Errore interno del server' });
    }
});

router.delete('/:id', async (req, res) => {
    // Inizia una sessione di transazione per garantire l'atomicità
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const organizationId = req.params.id;

        // 1. Pulisci il riferimento negli utenti
        await users.updateMany({ id_organization: organizationId }, { $set: { id_organization: null } }, { session });

        // 2. Pulisci il riferimento nei comuni
        await townHalls.updateMany(
            { $or: [{ organization_admin: organizationId }, { organizations_maintainers: organizationId }] },
            { 
                $unset: { organization_admin: "" }, // Rimuove il campo se è presente
                $pull: { organizations_maintainers: organizationId } // Rimuove l'ID dall'array
            },
            { session }
        );

        // 3. Trova e rimuovi l'organizzazione
        const deletedOrganization = await organizations.findByIdAndDelete(organizationId, { session });
        if (!deletedOrganization) {
            await session.abortTransaction();
            session.endSession();
            return res.status(404).json({ message: 'Organizzazione non trovata.' });
        }

        // Commit della transazione se tutto è andato a buon fine
        await session.commitTransaction();
        session.endSession();

        res.status(200).json({ message: 'Organizzazione e riferimenti correlati puliti con successo.' });

    } catch (error) {
        await session.abortTransaction();
        session.endSession();
        console.error("Errore durante l'eliminazione:", error);
        res.status(500).json({ message: 'Errore interno del server.' });
    }
});

router.delete('/:id/with-users', async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const organizationId = req.params.id;
        
        // 1. Trova e elimina l'organizzazione
        const deletedOrganization = await organizations.findByIdAndDelete(organizationId, { session });
        if (!deletedOrganization) {
            await session.abortTransaction();
            session.endSession();
            return res.status(404).json({ message: 'Organizzazione non trovata.' });
        }
        
        // 2. Elimina tutti gli utenti associati
        const result = await users.deleteMany({ id_organization: organizationId }, { session });

        // 3. Pulisci il riferimento nei comuni
        await townHalls.updateMany(
            { $or: [{ organization_admin: organizationId }, { organizations_maintainers: organizationId }] },
            { 
                $unset: { organization_admin: "" },
                $pull: { organizations_maintainers: organizationId }
            },
            { session }
        );

        await session.commitTransaction();
        session.endSession();

        res.status(200).json({
            message: `Organizzazione e ${result.deletedCount} utenti e relativi riferimenti nei comuni eliminati con successo.`,
        });

    } catch (error) {
        await session.abortTransaction();
        session.endSession();
        console.error("Errore durante l'eliminazione a cascata:", error);
        res.status(500).json({ message: 'Errore interno del server.' });
    }
});

module.exports = router;