const { Schema, model } = require("mongoose")
const townHalls = require("./townHalls")
const bcrypt = require('bcrypt');
//metodi della costante
const schema = new Schema({
    name: String,
    surname: String,
    email: String,
    password: {type: String, required: true},
    date: {type: Date, default: Date.now()},
    user_type: {type: String, enum: ['DEFAULT_USER', 'MAINTAINER', 'ADMINISTRATOR', 'SUPER_ADMIN'], default: 'DEFAULT_USER'},
    town_halls_list: [{type: Schema.Types.ObjectId, ref: 'townHalls'}],
    is_approved: {type: Boolean, default: false}
})

schema.pre('save', async function(next) {
    if (this.isModified('password') || this.isNew) {
        try {
            const salt = await bcrypt.genSalt(10);
            this.password = await bcrypt.hash(this.password, salt);
            next();
        } catch (err) {
            next(err);
        }
    } else {
        return next();
    }
});

// Metodo per confrontare la password inserita con quella hashata
schema.methods.comparePassword = async function(password) {
    return await bcrypt.compare(password, this.password);
};

//per esportare il modello
module.exports = model("users", schema)