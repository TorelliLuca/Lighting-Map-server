// generate-vapid-keys.js
const webpush = require('web-push');

// Genera la coppia di chiavi VAPID
const vapidKeys = webpush.generateVAPIDKeys();

console.log('--- VAPID Keys ---');
console.log('Public Key:');
console.log(vapidKeys.publicKey);
console.log('\nPrivate Key:');
console.log(vapidKeys.privateKey);
console.log('------------------');