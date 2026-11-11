// Adds clearly labeled preview content to an initialized ALU Gallery database.
// Run once with: node seed-sample-data.js
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const dataDir = path.resolve(process.env.ALU_DATA_DIR || path.join(__dirname, 'data'));
const db = new DatabaseSync(path.join(dataDir, 'alu-gallery.sqlite'));
db.exec('PRAGMA foreign_keys = ON;');
db.exec(`CREATE TABLE IF NOT EXISTS seed_metadata (key TEXT PRIMARY KEY, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);`);
if (db.prepare("SELECT 1 FROM seed_metadata WHERE key='sample-content-v1'").get()) {
  console.log('Sample content is already installed.');
  db.close();
  process.exit(0);
}

const partners = [
  ['African Leadership University', 'University', 'Kigali, Rwanda', 'ALU Gallery host institution.'],
  ['Sample Partner — Kigali School of Creative Arts', 'University', 'Kigali, Rwanda', 'Sample directory profile for app preview.'],
  ['Sample Partner — Nairobi Institute of Art', 'University', 'Nairobi, Kenya', 'Sample directory profile for app preview.'],
  ['Sample Partner — Accra Centre for Visual Culture', 'Cultural institution', 'Accra, Ghana', 'Sample directory profile for app preview.'],
];
const artists = [
  { name: 'Amara Niyonzima (Sample Artist)', email: 'sample-artist-01@alu-gallery.invalid', country: 'Rwanda', discipline: 'Painting', institution: 1, biography: 'Sample artist profile for the gallery preview. Replace with the artist’s approved biography.' },
  { name: 'Aline Murekatete (Sample Artist)', email: 'sample-artist-02@alu-gallery.invalid', country: 'Rwanda', discipline: 'Mixed media', institution: 1, biography: 'Sample artist profile for the gallery preview. Replace with the artist’s approved biography.' },
  { name: 'Nuru Kamau (Sample Artist)', email: 'sample-artist-03@alu-gallery.invalid', country: 'Kenya', discipline: 'Photography', institution: 2, biography: 'Sample artist profile for the gallery preview. Replace with the artist’s approved biography.' },
  { name: 'Zawadi Mbeki (Sample Artist)', email: 'sample-artist-04@alu-gallery.invalid', country: 'Tanzania', discipline: 'Textiles', institution: 2, biography: 'Sample artist profile for the gallery preview. Replace with the artist’s approved biography.' },
  { name: 'Kwame Mensah (Sample Artist)', email: 'sample-artist-05@alu-gallery.invalid', country: 'Ghana', discipline: 'Sculpture', institution: 3, biography: 'Sample artist profile for the gallery preview. Replace with the artist’s approved biography.' },
  { name: 'Sade Afolayan (Sample Artist)', email: 'sample-artist-06@alu-gallery.invalid', country: 'Nigeria', discipline: 'Digital art', institution: 3, biography: 'Sample artist profile for the gallery preview. Replace with the artist’s approved biography.' },
];
const works = [
  ['Sample work · Hills After Rain', 'Painting', 'Layered pigments and a quiet horizon study.', 'Amara Niyonzima (Sample Artist)', 0, 'photo-1541961017774-22349e4a1262'],
  ['Sample work · A Place to Begin', 'Mixed media', 'Paper, color and collected marks arranged in a study of belonging.', 'Aline Murekatete (Sample Artist)', 1, 'photo-1579783902614-a3fb3927b6a5'],
  ['Sample work · Crossing at First Light', 'Photography', 'A sample photographic study of reflection, color and movement.', 'Nuru Kamau (Sample Artist)', 2, 'photo-1577083552431-6e5fd01aa342'],
  ['Sample work · Woven Ground', 'Textiles', 'A sample textile composition built from rhythm and repeated forms.', 'Zawadi Mbeki (Sample Artist)', 3, 'photo-1578301978693-85fa9c0320b9'],
  ['Sample work · The Listening Form', 'Sculpture', 'A sculptural form imagined in warm clay and cast shadow.', 'Kwame Mensah (Sample Artist)', 4, 'photo-1577083288073-40892c0860a4'],
  ['Sample work · Night Garden', 'Digital art', 'A sample digital composition exploring memory and imagined landscapes.', 'Sade Afolayan (Sample Artist)', 5, 'photo-1579783901586-d88db74b4fe4'],
  ['Sample work · Small Blue Weather', 'Painting', 'A sample abstract study of movement, pigment and open space.', 'Amara Niyonzima (Sample Artist)', 0, 'photo-1549490349-8643362247b5'],
  ['Sample work · Many Colors, One River', 'Collage', 'A sample collage built around flow, repetition and shared ground.', 'Aline Murekatete (Sample Artist)', 1, 'photo-1641234381110-8c38e4ff97a6'],
  ['Sample work · Tidal Memory', 'Mixed media', 'A sample abstract work tracing the edges between land and water.', 'Nuru Kamau (Sample Artist)', 2, 'photo-1532799755889-1247a1b7f10e'],
  ['Sample work · Color Field No. 1', 'Printmaking', 'A sample print study of saturated color and changing forms.', 'Sade Afolayan (Sample Artist)', 5, 'photo-1532540983331-3260f8487880'],
];
const imageCredits = {
  'photo-1641234381110-8c38e4ff97a6': 'Susan Wilkinson, Unsplash',
  'photo-1532799755889-1247a1b7f10e': 'Ivan Bandura, Unsplash',
  'photo-1532540983331-3260f8487880': 'Steve A Johnson, Unsplash',
};
const events = [
  ['Sample event · Art, Place and Belonging', 'A sample public conversation about contemporary art, place and shared memory.', 'Artist talk', '2027-02-18T16:00:00', 'ALU Kigali Campus · Sample listing', 80],
  ['Sample event · Material Stories Workshop', 'A sample hands-on workshop exploring everyday materials and visual storytelling.', 'Workshop', '2027-03-06T10:00:00', 'ALU Kigali Campus · Sample listing', 30],
  ['Sample event · Open Studio Gathering', 'A sample studio gathering for artists, students and partner institutions.', 'Open studio', '2027-04-10T14:00:00', 'ALU Gallery · Sample listing', 60],
];
const exhibitions = [
  ['Sample exhibition · Home, Memory & Place', 'Sample works exploring place, memory and the stories held in everyday surroundings.', 'Home, memory and place', '2027-02-01', '2027-04-30', 'ALU Gallery · Sample listing', 'Sample preview exhibition. Replace with approved curatorial details.', 'published'],
  ['Sample exhibition · Material Futures', 'A sample open call for work made with reclaimed and locally sourced materials.', 'Material culture', '2027-05-01', '2027-07-30', 'Online · Sample listing', 'Submit one work with a short description and materials list.', 'open for submissions'],
  ['Sample exhibition · Lines of Connection', 'A sample collaborative exhibition preview for partner institutions.', 'Connection and exchange', '2027-08-01', '2027-10-30', 'ALU Gallery · Sample listing', 'Sample preview exhibition. Replace with approved curatorial details.', 'upcoming'],
];

const insertInstitution = db.prepare('INSERT INTO institutions(name,type,location,description,status) VALUES(?,?,?,?,\'approved\') ON CONFLICT(name) DO UPDATE SET type=excluded.type,location=excluded.location,description=excluded.description,status=\'approved\'');
const insertUser = db.prepare("INSERT INTO users(email,full_name,password_salt,password_hash,role,institution_id,status) VALUES(?,?,?,?, 'artist',?,'demo') ON CONFLICT(email) DO UPDATE SET full_name=excluded.full_name,institution_id=excluded.institution_id,status='demo'");
const selectUser = db.prepare('SELECT id FROM users WHERE email=?');
const insertProfile = db.prepare('INSERT INTO artist_profiles(user_id,biography,country,discipline) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET biography=excluded.biography,country=excluded.country,discipline=excluded.discipline');
const insertArtwork = db.prepare("INSERT INTO artworks(owner_id,institution_id,title,description,image_path,category,medium,tags,copyright,status) VALUES(?,?,?,?,?,?,?,?,?,'published')");
const insertExhibition = db.prepare('INSERT INTO exhibitions(title,description,theme,starts_at,ends_at,venue,requirements,status,created_by) VALUES(?,?,?,?,?,?,?,?,?)');
const insertSubmission = db.prepare("INSERT INTO submissions(artwork_id,exhibition_id,submitter_id,status,feedback,reviewed_at) VALUES(?,?,?,'approved','Sample preview record; replace with a real review decision.',CURRENT_TIMESTAMP)");
const insertEvent = db.prepare("INSERT INTO events(title,description,kind,starts_at,venue,capacity,status,created_by) VALUES(?,?,?,?,?,?, 'registration open',?)");
const markSeeded = db.prepare("INSERT INTO seed_metadata(key) VALUES('sample-content-v1')");

try {
  db.exec('BEGIN IMMEDIATE;');
  const institutionIds = partners.map(p => {
    insertInstitution.run(...p);
    return db.prepare('SELECT id FROM institutions WHERE name=?').get(p[0]).id;
  });
  const artistIds = artists.map((a, index) => {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(crypto.randomBytes(32).toString('hex'), salt, 64).toString('hex');
    insertUser.run(a.email, a.name, salt, hash, institutionIds[a.institution]);
    const id = selectUser.get(a.email).id;
    insertProfile.run(id, a.biography, a.country, a.discipline);
    return id;
  });
  const createdBy = artistIds[0];
  const exhibitionIds = exhibitions.map(x => Number(insertExhibition.run(...x.slice(0, 7), x[7], createdBy).lastInsertRowid));
  works.forEach((work, index) => {
    const artistIndex = artists.findIndex(a => a.name === work[3]);
    const ownerId = artistIds[artistIndex];
    const imageUrl = `https://images.unsplash.com/${work[5]}?auto=format&fit=crop&w=1000&q=82`;
    const credit = imageCredits[work[5]] || 'Unsplash image used in the original app preview';
    const result = insertArtwork.run(ownerId, institutionIds[artists[artistIndex].institution], work[0], `${work[2]} This is sample content for preview; replace it with artist-submitted work and verified details.`, imageUrl, work[1], 'Sample image', 'sample, preview', `Image credit: ${credit}. Illustrative sample record; replace before official publication.`);
    insertSubmission.run(Number(result.lastInsertRowid), exhibitionIds[index < 5 ? 0 : 2], ownerId);
  });
  events.forEach(e => insertEvent.run(...e, createdBy));
  markSeeded.run();
  db.exec('COMMIT;');
  console.log(`Installed ${works.length} sample artworks, ${artists.length} sample artists, ${events.length} sample events, ${exhibitions.length} sample exhibitions, and ${partners.length} partner institutions.`);
} catch (error) {
  db.exec('ROLLBACK;');
  throw error;
} finally {
  db.close();
}
