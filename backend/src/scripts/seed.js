require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { connectDB } = require('../db');
const { User, City, ShippingCompany, Settings } = require('../models');
const { roleDefaults } = require('../constants');

const CITIES = [
  ['Casablanca', 20, 'Zone A'],
  ['Mohammedia', 20, 'Zone A'],
  ['Bouskoura', 20, 'Zone A'],
  ['Dar Bouazza', 20, 'Zone A'],
  ['Rabat', 35, 'Zone B'],
  ['Salé', 35, 'Zone B'],
  ['Témara', 35, 'Zone B'],
  ['Kénitra', 35, 'Zone B'],
  ['El Jadida', 35, 'Zone B'],
  ['Settat', 35, 'Zone B'],
  ['Berrechid', 35, 'Zone B'],
  ['Marrakech', 35, 'Zone B'],
  ['Fès', 35, 'Zone B'],
  ['Meknès', 35, 'Zone B'],
  ['Tanger', 45, 'Zone C'],
  ['Tétouan', 45, 'Zone C'],
  ['Agadir', 45, 'Zone C'],
  ['Oujda', 45, 'Zone C'],
  ['Nador', 45, 'Zone C'],
  ['Essaouira', 45, 'Zone C'],
  ['Safi', 45, 'Zone C'],
  ['Beni Mellal', 45, 'Zone C'],
  ['Khouribga', 45, 'Zone C'],
  ['Ouarzazate', 45, 'Zone C'],
  ['Errachidia', 45, 'Zone C'],
  ['Taza', 45, 'Zone C'],
  ['Al Hoceima', 45, 'Zone C'],
  ['Laâyoune', 45, 'Zone C'],
  ['Dakhla', 45, 'Zone C'],
  ['Guelmim', 45, 'Zone C'],
  ['Tiznit', 45, 'Zone C']
];

const CARRIERS = ['Amana', 'Cathedis', 'Sendit', 'Ozone Express', 'Speedaf'];

async function seed() {
  await connectDB();
  await Settings.findOneAndUpdate(
    { key: 'company' },
    {
      key: 'company',
      companyName: 'FBMS',
      legalName: 'Full Business Management System',
      city: 'Casablanca',
      country: 'Maroc',
      phone: '0707625535',
      currency: 'MAD',
      lowStockThreshold: 5
    },
    { upsert: true }
  );
  for (const [name, shippingPrice, zone] of CITIES) {
    await City.findOneAndUpdate(
      { name },
      { name, shippingPrice, zone, notes: 'Tarif initial configurable par ville', active: true },
      { upsert: true }
    );
  }
  for (const name of CARRIERS) {
    await ShippingCompany.findOneAndUpdate(
      { name },
      { name, active: true, notes: '' },
      { upsert: true }
    );
  }
  const email = 'admin@fbms.ma';
  const existing = await User.findOne({ email });
  if (!existing) {
    await User.create({
      name: 'Super Admin',
      email,
      password: 'Admin@12345',
      role: 'super_admin',
      permissions: roleDefaults('super_admin'),
      language: 'fr'
    });
    console.log('Admin créé: admin@fbms.ma / Admin@12345');
  } else {
    console.log('Admin déjà présent');
  }
  console.log(`Villes: ${await City.countDocuments()} · Sociétés: ${await ShippingCompany.countDocuments()}`);
  process.exit(0);
}

seed().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
