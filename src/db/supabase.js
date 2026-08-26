require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY;

let supabase = null;
if (supabaseUrl && supabaseKey) {
  supabase = createClient(supabaseUrl, supabaseKey);
  console.log('✅ Supabase client initialized successfully.');
} else {
  console.log('⚠️ Supabase credentials not found in process.env. Using local fallback mode.');
}

async function fetchDriversFromDb() {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('drivers')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching drivers from Supabase:', error.message);
    return null;
  }
  return data;
}

async function insertDriverToDb(driverObj) {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('drivers')
    .insert([
      {
        driver: driverObj.driver,
        plate: driverObj.plate,
        phone: driverObj.phone,
        entry: driverObj.entry || '*',
        exit: driverObj.exit || '*',
        ramp: driverObj.ramp || '*',
        note: driverObj.note || ''
      }
    ])
    .select();

  if (error) {
    console.error('Error inserting driver to Supabase:', error.message);
    return null;
  }
  return data ? data[0] : null;
}

async function updateDriverEtaInDb(cleanPhoneDigits, etaTime) {
  if (!supabase) return null;

  // Find matching driver in Supabase
  const { data: drivers } = await supabase.from('drivers').select('*');
  if (!drivers) return null;

  const target = drivers.find(d => {
    const dDigits = d.phone.replace(/[^0-9]/g, '').slice(-10);
    return dDigits.length > 5 && dDigits === cleanPhoneDigits;
  });

  if (!target) return null;

  const { data, error } = await supabase
    .from('drivers')
    .update({ note: etaTime })
    .eq('id', target.id)
    .select();

  if (error) {
    console.error('Error updating driver ETA in Supabase:', error.message);
    return null;
  }
  return data ? data[0] : null;
}

async function clearAllDriverEtasInDb() {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('drivers')
    .update({ note: '' })
    .gt('id', 0);

  if (error) {
    console.error('Error clearing all driver ETAs in Supabase:', error.message);
    return null;
  }
  return data;
}

async function deleteDriverFromDb(driverId) {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('drivers')
    .delete()
    .eq('id', driverId)
    .select();

  if (error) {
    console.error('Error deleting driver from Supabase:', error.message);
    return null;
  }
  return data ? data[0] : null;
}

module.exports = {
  supabase,
  fetchDriversFromDb,
  insertDriverToDb,
  updateDriverEtaInDb,
  clearAllDriverEtasInDb,
  deleteDriverFromDb
};
