const { MongoClient } = require('mongodb');
const fs = require('fs').promises;

const MONGO_URI = "mongodb+srv://torelliStudio:L1ghting-m4p-1854@lightingmap.vlfo8t5.mongodb.net/LightingMap_Production?retryWrites=true&w=majority&appName=LightingMap";
const TOWN_ID = '671e83b388b588ac16c7fa58';

async function backupTownhall() {
  const BACKUP_DIR = `backup_${Date.now()}`;
  await fs.mkdir(BACKUP_DIR, { recursive: true });
  
  console.log('🔄 Inizio backup...');
  
  const client = new MongoClient(MONGO_URI);
  
  try {
    await client.connect();
    const db = client.db();
    
    // 1. Esporta townhall
    console.log('📍 Esportazione townhall...');
    const { ObjectId } = require('mongodb');
    const townhall = await db.collection('townhalls').findOne({
      _id: new ObjectId(TOWN_ID)
    });
    
    if (!townhall) {
      throw new Error('Townhall non trovata!');
    }
    
    await fs.writeFile(
      `${BACKUP_DIR}/townhall.json`,
      JSON.stringify(townhall, null, 2)
    );
    
    // 2. Esporta lightpoints
    if (townhall.punti_luce?.length > 0) {
      console.log(`💡 Esportazione ${townhall.punti_luce.length} lightpoints...`);
      const lightpoints = await db.collection('lightpoints').find({
        _id: { $in: townhall.punti_luce }
      }).toArray();
      
      await fs.writeFile(
        `${BACKUP_DIR}/lightpoints.json`,
        JSON.stringify(lightpoints, null, 2)
      );
      console.log(`   ✓ Esportati ${lightpoints.length} lightpoints`);
    }
    
    // 3. Esporta borders
    if (townhall.borders) {
      console.log('🗺️  Esportazione borders...');
      const borders = await db.collection('borders').findOne({
        _id: townhall.borders
      });
      
      if (borders) {
        await fs.writeFile(
          `${BACKUP_DIR}/borders.json`,
          JSON.stringify(borders, null, 2)
        );
      }
    }
    
    // 4. Esporta organization_admin
    if (townhall.organization_admin) {
      console.log('👤 Esportazione organization_admin...');
      const orgAdmin = await db.collection('organizations').findOne({
        _id: townhall.organization_admin
      });
      
      if (orgAdmin) {
        await fs.writeFile(
          `${BACKUP_DIR}/organization_admin.json`,
          JSON.stringify(orgAdmin, null, 2)
        );
      }
    }
    
    // 5. Esporta organizations_maintainers
    if (townhall.organizations_maintainers?.length > 0) {
      console.log('👥 Esportazione organizations_maintainers...');
      const maintainers = await db.collection('organizations').find({
        _id: { $in: townhall.organizations_maintainers }
      }).toArray();
      
      if (maintainers.length > 0) {
        await fs.writeFile(
          `${BACKUP_DIR}/organizations_maintainers.json`,
          JSON.stringify(maintainers, null, 2)
        );
        console.log(`   ✓ Esportati ${maintainers.length} maintainers`);
      }
    }
    
    // 6. Crea file di riepilogo
    const summary = {
      backup_date: new Date(),
      townhall_id: TOWN_ID,
      townhall_name: townhall.name,
      statistics: {
        lightpoints: townhall.punti_luce?.length || 0,
        has_borders: !!townhall.borders,
        has_organization_admin: !!townhall.organization_admin,
        maintainers: townhall.organizations_maintainers?.length || 0
      }
    };
    
    await fs.writeFile(
      `${BACKUP_DIR}/backup_info.json`,
      JSON.stringify(summary, null, 2)
    );
    
    console.log(`\n✅ Backup completato in: ${BACKUP_DIR}`);
    console.log(`📊 Statistiche:`);
    console.log(`   - Lightpoints: ${summary.statistics.lightpoints}`);
    console.log(`   - Borders: ${summary.statistics.has_borders ? 'Sì' : 'No'}`);
    console.log(`   - Organization admin: ${summary.statistics.has_organization_admin ? 'Sì' : 'No'}`);
    console.log(`   - Maintainers: ${summary.statistics.maintainers}`);
    
  } finally {
    await client.close();
  }
}

backupTownhall().catch(console.error);